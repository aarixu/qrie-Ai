import {
  boxOf,
  textWidth,
  union,
  noteBoxHeight,
  splitPartRef,
  type ImagePart,
  type Rect,
  CANVAS_H,
  CANVAS_W,
  fitText,
  writeMs,
  PAGE_STRIDE,
  wrapLines,
  listBoxHeight,
  type Element,
  type Beat,
  type WorkArea,
} from '@ai-tutor/lesson-format';
import type { Instruction, LaidOutBeat, ScriptBeat } from './types';
import {
  annotateElement,
  connectElements,
  connectionRegion,
  labelIdFor,
  layoutScene,
} from './scene';
import { resolveOverlaps, type Bond, type Leash } from './collide';

/**
 * The board's three bands. Nothing is ever placed outside them, and nothing
 * from one band can reach into another.
 *
 * TOP holds the heading. BOTTOM holds the one-line caption. Everything the
 * lesson is actually about lives in MAIN, stacked. Fixing the bands is what
 * makes "a title and a caption never collide with the teaching" true by
 * construction rather than by care.
 */
const TOP = { y: 56, h: 76 };
const MAIN = { y: 150, h: 330 };
const BOTTOM = { y: 548, h: 40 };

/** Side margins, and the gap between two stacked blocks. */
const SIDE = 70;
const GUTTER = 26;
const WIDTH = CANVAS_W - SIDE * 2;

/** A card row never gets thinner than this before it wraps to fewer per row. */
const MIN_CARD_W = 240;

/**
 * How far apart two pages of an endless board sit.
 *
 * Wider than a page, so the camera's breathing room never lets the edge of the
 * last page lean into the shot. It lives here because layout now decides where
 * a page ENDS — when a beat has more than a board's worth on it, the rest goes
 * on the next one — and the assembler slides whole beats by the same stride.
 */
export { PAGE_STRIDE } from '@ai-tutor/lesson-format';

/**
 * The least room a block that would otherwise take "whatever is left" may have.
 *
 * There used to be no floor, and the arithmetic did exactly what it was told:
 * a beat carrying a list and two key points needed 397 units of a 330-unit
 * band, so the leftover was zero, the scene was given a height of zero, and its
 * icons came out with a NEGATIVE picture inside a 26-unit box. The stack, being
 * taller than the band, was then centred — which put it above the band
 * entirely, on top of the title.
 *
 * Nothing about that was recoverable by shrinking. The board is endless; the
 * answer to "this does not fit" is another page.
 */
const MIN_FLEXIBLE_H = 150;

/** Heights the renderer needs to agree with; see the notes on each. */
const EQUATION_H = 52;
const WRITE_H = 62;
const CARD_H = 128;
/**
 * The work area under a held question: room for three lines of handwriting at
 * the default handwriting size (26, what `boxOf` assumes for a `handwrite`),
 * and never less than two. Below two lines there is no working to hold, so no area is reserved and
 * a live board opens a fresh page instead (see `Beat.workArea`).
 *
 * Functions rather than constants because `handLead` is declared further down.
 */
const workFull = (): number => 3 * handLead(26);
const workLeast = (): number => 2 * handLead(26);

/**
 * A figure with the key points written under it.
 *
 * A labelled picture has already given both margins to the names of its parts,
 * so a sentence that belongs to no single part — a rule, a comparison, the line
 * worth remembering — has nowhere to go but underneath. Which is where a
 * teacher writes it anyway.
 *
 * The band borrows the room below MAIN first, because it is otherwise empty and
 * the caption does not start until 548, and only then takes height off the
 * picture. There is a floor on the picture: below it the figure is a thumbnail
 * and the beat has become about its own captions.
 */
const SPARE_BELOW = 58;
const BAND_GAP = 16;
const POINT_GAP = 10;
const MIN_FIGURE_H = 190;
/** The sizes a band is written at, largest first. All its points share one. */
const BAND_SIZES = [30, 26, 23, 20];

/**
 * From one handwritten line to the next.
 *
 * The height comes from the same function the camera and the overlap solver
 * measure this element with, plus the clearance the solver wants. Guessed
 * separately it was 1.5 em in one place and 1.62 in another, and the tighter
 * of the two read as a collision — so the solver shrank a key point until it
 * fitted a gap that was never real.
 */
const handLead = (size: number): number =>
  boxOf({ kind: 'handwrite', id: '_lead', x: 0, y: 0, text: 'x', size }).h + 10;

/**
 * When the nth line of a written block may start: after every line above it.
 *
 * A line takes as long as its own words — that is the renderer's rule and now
 * this one's too. A flat count per line meant a long line was still being
 * written when the line below it began.
 */
const afterLines = (lines: readonly string[], n: number): number =>
  lines.slice(0, n).reduce((sum, line) => sum + writeMs(line), 0);
/** Rough wrapped height of a note at the renderer's 17px/1.55 in board units. */

/** One thing to place, and how much vertical room it insists on. */
interface Block {
  /**
   * The instruction that made it.
   *
   * The stack does not usually care — a block is a block. It matters for one
   * arrangement: a picture with written points belongs BESIDE them, not above
   * them, and recognising that shape needs to know which block is which.
   */
  kind: Instruction['do'] | 'work';
  /** The artwork this block places, when it places artwork. */
  ref?: string;
  /** Fixed height, or null to share whatever is left over. */
  height: number | null;
  /**
   * Must share a page with the block before it.
   *
   * Set on the pieces of a held question — its lettered options and the work
   * area under it — so the stacker never turns the page between a question
   * and the room reserved for answering it. When a glued block does not fit,
   * the blocks it is glued to move to the next page WITH it.
   */
  glued?: boolean;
  /**
   * Whether this can be drawn in half a board without becoming unreadable.
   *
   * A picture can be shrunk; a row of five boxes cannot. Squeezed into a
   * column beside a list, a five-step flow left forty-two units per step, and
   * "refraction" does not fit in forty-two units at any size a person reads —
   * so its labels overhung into the steps on either side and five notes came
   * out as one stripe across the board.
   */
  narrow?: boolean;
  /**
   * Which instruction made this block, or null if it records its own.
   *
   * Blocks are laid out AFTER the whole beat has been read, because a block's
   * height depends on how many others there are. By then the reading position
   * is at the end of the beat — so without this every card, note, equation and
   * handwritten line was attributed to the last thing in the beat, and a board
   * that should have filled in line by line arrived all at once on the final
   * word.
   *
   * The scene is the one block made of MANY instructions — a place here, a
   * connector three words later — so it writes its own attribution and passes
   * null. Attributing it as a whole would show the school on the line that
   * only mentioned the two children.
   */
  at: number | null;
  /** Turn an allotted rectangle into elements. */
  place: (rect: { x: number; y: number; w: number; h: number }) => Element[];
}

const idFor = (beatId: string, index: number, suffix = ''): string =>
  `${beatId}_${index}${suffix}`;

/**
 * How tall a note will be once wrapped.
 *
 * Approximated from character count rather than measured, because the layout
 * runs with no DOM. It only has to be close: the note is drawn in a
 * foreignObject that wraps on its own, so being a line out shifts the stack
 * slightly rather than clipping anything.
 */
/** The stacker budgets exactly what the box claims and the tutor draws. */
const noteHeight = noteBoxHeight;

/**
 * Break a written line into lines that fit a column.
 *
 * On whole words, because a teacher does not hyphenate on a board. A single
 * word longer than the column stays on its own line and overhangs slightly,
 * which is what happens on a real board too.
 */
/**
 * How the key points written under a figure are laid out: one size for all of
 * them, the largest that fits the room they have.
 *
 * One size because a list in three different sizes reads as a machine fitting
 * text into gaps, not as a person writing. The room is what is left once the
 * figure has kept its floor; if even the smallest size wants more than that,
 * the smallest is used and the figure gives up the difference.
 */
function planBand(
  texts: readonly string[],
  w: number,
  room: number,
): { size: number; lines: string[][]; height: number } {
  if (texts.length === 0) return { size: 0, lines: [], height: 0 };
  let band = { size: 0, lines: [] as string[][], height: 0 };
  for (const size of BAND_SIZES) {
    const lines = texts.map((text) => wrapText(text, w, size));
    const lead = handLead(size);
    band = {
      size,
      lines,
      height:
        lines.reduce((sum, ls) => sum + ls.length * lead, 0) + (texts.length - 1) * POINT_GAP,
    };
    if (band.height <= room) break;
  }
  return band;
}

/**
 * Wrapped to a column, keeping a little of it clear.
 *
 * The BREAKING is `wrapLines` in lesson-format, beside the width measurement it
 * is made of — this file used to carry its own copy that guessed half an em per
 * character, packed more onto a line than would fit, and ran text past the very
 * margin it was wrapping for.
 *
 * The six percent held back is the only part that belongs here: a board is not
 * a page, and text that reaches the edge of its column reads as though it ran
 * out of room.
 */
function wrapText(text: string, w: number, size: number): string[] {
  return wrapLines(text, w * 0.94, size);
}

/**
 * Turn one beat's instructions into positioned elements.
 *
 * Consecutive `card` instructions become one row, because that is what a person
 * means by two cards — side by side, equal width, aligned — and asking a model
 * to work that out is asking for the bug this package exists to remove.
 */
export interface RevealStep {
  /** What the tutor says while this step's elements arrive. */
  narration: string;
  /** Every element visible by the END of this step — a complete set, not a delta. */
  show: string[];
  focus: string[];
}

/**
 * A beat, laid out once and revealed in pieces.
 *
 * Layout runs over the WHOLE beat before anything is revealed, so the school
 * occupies the same spot whether it has appeared yet or not. Revealing it later
 * then costs nothing: the board does not reflow when a word lands, it fills in.
 * Reflowing on every noun is what would make a scene jump about while the tutor
 * is talking over it.
 */
/**
 * Where a named part of a picture is, in board units.
 *
 * The one place that turns `kidney#cortex` into a rectangle, so a circle round
 * a part and a line pointing at it can never disagree about where it is.
 */
/**
 * The box a picture will actually be DRAWN in, inside the room it was given.
 *
 * The renderer fits an image to its box and centres it, so a square picture in
 * a wide box is drawn narrower with empty board either side. Layout used to
 * hand over the whole room and believe the picture filled it — and then place
 * every part box as a fraction of that room. A part on the left of the picture
 * was circled in the empty strip beside it.
 *
 * So the fitting happens HERE, once, and the element IS the picture. The
 * renderer's `meet` then has nothing left to do, and a fraction of the element
 * is a fraction of what the student sees.
 *
 * A picture whose shape was never measured keeps the whole room, which is
 * exactly what happened before any of this existed.
 */
function fitPicture(r: Rect, aspect: number | undefined): Rect {
  if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0) return r;
  const w = Math.min(r.w, r.h * aspect);
  const h = w / aspect;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

function partBox(target: string, elements: readonly Element[]): Rect | null {
  const { elementId, part } = splitPartRef(target);
  const host = elements.find((el) => el.id === elementId);
  if (!host) return null;
  const box = boxOf(host);
  if (part === null) return box;
  const named = host.kind === 'image' ? (host.parts ?? []).find((q) => q.name === part) : undefined;
  // A part nobody could find is not pointed at. A line to the middle of a
  // picture, drawn because we guessed, points at the wrong thing with complete
  // confidence.
  if (!named) return null;
  return {
    x: box.x + named.x * box.w,
    y: box.y + named.y * box.h,
    w: named.w * box.w,
    h: named.h * box.h,
  };
}

export function layoutBeat(
  beat: ScriptBeat,
  /**
   * Where the named parts of each generated picture are, as fractions of it.
   *
   * Layout owns board geometry, always. But WHERE the cortex is inside a
   * picture of a kidney is not a layout decision — it is a fact about that
   * picture, discovered by looking at it. So it arrives here as a fact, and
   * layout does what it always does: turns facts into coordinates.
   */
  parts: ReadonlyMap<string, readonly ImagePart[]> = new Map(),
  /**
   * The shape of each generated picture — its width over its height.
   *
   * Also a fact about the picture that was made rather than a layout decision,
   * and it arrives the same way its parts do. Without it the board places a
   * picture in a box of the wrong shape and then marks parts of the box.
   */
  shapes: ReadonlyMap<string, number> = new Map(),
): {
  elements: Element[];
  laid: LaidOutBeat;
  steps: RevealStep[];
  /**
   * Pairs that are MEANT to overlap — a mark and what it marks, a card's frame
   * and the words inside it.
   *
   * Returned rather than kept private so a caller checking the board for
   * collisions sees the same truth the solver did. A checker that re-derived
   * this would eventually disagree with it, and then either flag a correct
   * board or pass a broken one.
   */
  bonds: Bond[];
  /** Labels tied to what they name. */
  leashes: Leash[];
  /**
   * How many pages of the endless board this beat used.
   *
   * Usually one. More when the beat had more on it than a board holds, which
   * is answered by turning the page rather than by writing smaller — so the
   * assembler has to know how far to slide whatever comes next.
   */
  pages: number;
  /**
   * The questions this beat stops on, by the index of the say that asks — and
   * the board kept clear under each one for the student's working, when the
   * question's page had room for it.
   */
  asks: { step: number; ask: NonNullable<Beat['ask']>; workArea?: WorkArea }[];
} {
  const elements: Element[] = [];
  const show: string[] = [];
  const focus: string[] = [];
  const blocks: Block[] = [];

  /**
   * Which element ids each ITEM produced, keyed by the item's index in the
   * expanded list below. Reveal reads by BOARD index, and an ask with options
   * is one board instruction but two items, so `origin` maps one onto the
   * other before reveal ever sees it (see the end of this function).
   */
  const byInstruction = new Map<number, string[]>();
  let current = -1;
  const emit = (el: Element, focused = false): void => {
    elements.push(el);
    show.push(el.id);
    if (focused) focus.push(el.id);
    // -1 is a block that recorded its own ids, instruction by instruction.
    if (current < 0) return;
    const list = byInstruction.get(current);
    if (list) list.push(el.id);
    else byInstruction.set(current, [el.id]);
  };

  /**
   * An ask becomes ordinary ink plus a marker.
   *
   * Expanded here, before anything else reads the board, so there is exactly
   * one code path for writing and listing: the question is a `write` and the
   * options are a lettered `list`, laid out and revealed like any other ink.
   * The marker records WHICH spoken moment carries the question, for the
   * assembler to pin on the lesson beat the player will hold.
   */
  const asks: { step: number; ask: NonNullable<Beat['ask']>; workArea?: WorkArea }[] = [];
  const items: Instruction[] = [];
  /** The board index each item came from: `origin[item] = board index`. */
  const origin: number[] = [];
  /** Item index of each ask's written question, by ask number. */
  const questionItem = new Map<number, number>();
  /** Items that must share a page with the item before them. */
  const gluedItems = new Set<number>();
  /** The last item of an ask, after which its work area goes, by ask number. */
  const workAfter = new Map<number, number>();
  /** How tall each ask's work area is; absent when its page has no room. */
  const workHeight = new Map<number, number>();
  /** Where each work area landed, by ask number, filled in as blocks are placed. */
  const workRects = new Map<number, Rect>();
  let saysSeen = 0;
  beat.board.forEach((step, boardIndex) => {
    if (step.do === 'say') saysSeen += 1;
    if (step.do !== 'ask') {
      items.push(step);
      origin.push(boardIndex);
      return;
    }
    const n = asks.length;
    asks.push({
      step: Math.max(0, saysSeen - 1),
      ask: {
        question: step.question,
        ...(step.options ? { options: step.options } : {}),
        ...(step.expect ? { expect: step.expect } : {}),
        ...(step.hint ? { hint: step.hint } : {}),
      },
    });
    items.push({ do: 'write', text: step.question, tone: 'accent' });
    origin.push(boardIndex);
    questionItem.set(n, items.length - 1);
    /** What the question and its options take, so the work area gets the rest of a page. */
    let taken = WRITE_H;
    if (step.options && step.options.length > 0) {
      const lettered = step.options.map((option, k) => ({
        term: String.fromCharCode(65 + k),
        meaning: option.text,
      }));
      items.push({ do: 'list', items: lettered });
      origin.push(boardIndex);
      gluedItems.add(items.length - 1);
      taken += GUTTER + listBoxHeight(lettered, undefined, WIDTH * 0.82);
    }
    const room = Math.min(workFull(), MAIN.h - taken - GUTTER);
    if (room >= workLeast()) {
      workAfter.set(items.length - 1, n);
      workHeight.set(n, room);
    }
  });

  /**
   * THE WORK AREA: board kept clear under a held question.
   *
   * A block with no ink of its own. It is glued to the question (and the
   * options, when there are any) so it always lands on the question's page,
   * and where it lands is recorded for the assembler to put on the lesson
   * beat. Nothing is ever placed in it here; the overlap gate in class-prep
   * checks that nothing else was either.
   */
  const workBlock = (n: number, height: number): Block => ({
    kind: 'work',
    at: null,
    height,
    glued: true,
    place: (r) => {
      workRects.set(n, { x: r.x, y: r.y, w: r.w, h: r.h });
      return [];
    },
  });

  // The scene is laid out as ONE block, because a connector cannot be drawn
  // until both of its ends have somewhere to be. Collecting the places first is
  // what lets an arrow start at the edge of a box rather than guess.
  const places = items.filter((it) => it.do === 'place') as Extract<Instruction, { do: 'place' }>[];
  /** Pairs that are meant to overlap, so the solver leaves them alone. */
  const bonds: Bond[] = [];
  const leashes: Leash[] = [];
  /**
   * Marks on things that are not scene places — a whole picture, or a named
   * part inside one.
   *
   * They wait for the stacking pass, because a block does not know its own
   * rectangle until every block in the beat has been counted. Held here with
   * the instruction that asked for them, so they still appear on the word that
   * named them.
   */
  const pendingMarks: { at: number; id: string; step: Extract<Instruction, { do: 'annotate' }> }[] =
    [];
  /**
   * Names to write in the margin, each with a line to the part it names.
   *
   * They wait alongside the marks, and for the same reason: neither can be
   * placed until the picture knows its own rectangle.
   */
  const pendingLabels: { at: number; id: string; step: Extract<Instruction, { do: 'label' }> }[] =
    [];
  /**
   * The key points, held for the same reason the names are.
   *
   * They go under the figure, and how far under depends on how tall the figure
   * turned out — which is not known until the whole beat has been read.
   */
  const pendingWrites: { at: number; id: string; step: Extract<Instruction, { do: 'write' }> }[] =
    [];
  /** A drawing to put beside the picture, once the picture knows where it is. */
  let pendingSketch: { at: number; id: string; step: Extract<Instruction, { do: 'sketch' }> } | null =
    null;
  let sceneEmitted = false;
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const index = i;
    current = i;

    switch (item.do) {
      case 'title': {
        emit({
          kind: 'title',
          id: idFor(beat.id, index),
          x: CANVAS_W / 2,
          y: TOP.y + 30,
          text: item.text,
          ...(item.sub ? { sub: item.sub } : {}),
        });
        i += 1;
        break;
      }

      case 'caption': {
        emit({
          kind: 'text',
          id: idFor(beat.id, index),
          x: CANVAS_W / 2,
          y: BOTTOM.y + 14,
          text: item.text,
        });
        i += 1;
        break;
      }

      case 'picture': {
        const ref = item.ref;
        // A picture takes whatever room the rest of the beat leaves it, and
        // its named parts come with it so a mark can find them.
        blocks.push({
          kind: item.do,
          ref,
          at: index,
          height: null,
          place: (r) => [
            {
              kind: 'image',
              id: ref,
              ...fitPicture(r, shapes.get(ref)),
              src: `generated/${ref}.png`,
              alt: ref.replace(/_/g, ' '),
              ...(parts.get(ref) ? { parts: [...parts.get(ref)!] } : {}),
            } as Element,
          ],
        });
        i += 1;
        break;
      }

      case 'diagram': {
        const ref = item.ref;
        // A picture takes whatever room the rest of the beat leaves it.
        blocks.push({
          kind: item.do,
          ref,
          at: index,
          height: null,
          place: (r) => {
            const el: Element = {
              kind: 'diagram',
              id: ref,
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              src: `generated/${ref}.svg`,
              alt: ref.replace(/_/g, ' '),
              parts: [],
            };
            return [el];
          },
        });
        i += 1;
        break;
      }

      case 'chart': {
        blocks.push({
          kind: item.do,
          at: index,
          height: null,
          place: (r) => [
            {
              kind: 'chart',
              id: idFor(beat.id, index),
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              chartType: 'bar',
              ...(item.caption ? { caption: item.caption } : {}),
              ...(item.unit ? { unit: item.unit } : {}),
              data: item.data,
              ...(item.tone ? { tone: item.tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'flow': {
        blocks.push({
          kind: item.do,
          at: index,
          // Four steps across half a board is about eighty units each, which is
          // already tight; five is past what fitting can rescue.
          narrow: item.steps.length <= 3,
          height: 120,
          place: (r) => [
            {
              kind: 'flow',
              id: idFor(beat.id, index),
              x: r.x,
              y: r.y,
              w: r.w,
              steps: item.steps,
              ...(item.tone ? { tone: item.tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'equation': {
        blocks.push({
          kind: item.do,
          at: index,
          height: EQUATION_H,
          // Centred in the rectangle it was GIVEN, never on the first page's
          // middle. `r.x` carries the page: a block the stacker moved to page
          // two gets page two's x. Centring on CANVAS_W / 2 drew an overflowed
          // equation back on page one, over the lines already there — b3_12
          // over b3_7 in the first maths class ever prepared.
          place: (r) => [
            {
              kind: 'formula',
              id: idFor(beat.id, index),
              x: r.x + r.w / 2,
              y: r.y + EQUATION_H * 0.66,
              text: item.text,
            },
          ],
        });
        i += 1;
        break;
      }

      case 'write': {
        pendingWrites.push({ at: index, id: idFor(beat.id, index), step: item });
        /**
         * A LONG LINE ON THE FULL BOARD WRAPS RATHER THAN SHRINKING (2026-09-29).
         *
         * Shrunk to fit one line, a held question like "When you put y equals
         * five into x equals fourteen minus y, what value do you get for x?"
         * came out at size 17 across the whole board — and the camera, framing
         * that one line and the work area under it, drew it a few pixels high on
         * a phone. Below size 28 it is written on two or more lines at 30
         * instead, and the block is as tall as those lines.
         */
        const wideFit = fitText(item.text, WIDTH * 0.94, 36, 17);
        const wideLines = wideFit >= 28 ? null : wrapText(item.text, WIDTH * 0.9, 30);
        blocks.push({
          kind: item.do,
          at: index,
          height: wideLines ? wideLines.length * handLead(30) + 14 : WRITE_H,
          // Written on the centreline when it has the board, and inside its
          // own column when it is sharing with a picture. In a column it
          // WRAPS rather than shrinking: a key point squeezed to fit one line
          // of a narrow column came out too small to read from a desk, which
          // is the one thing a key point may not be.
          place: (r) => {
            const narrow = r.w < WIDTH * 0.75;
            if (!narrow && wideLines) {
              const lead = handLead(30);
              const top = r.y + 30 * 0.9;
              return wideLines.map((line, n) => ({
                kind: 'handwrite',
                ...(n > 0 ? { after: afterLines(wideLines, n) } : {}),
                id: n === 0 ? idFor(beat.id, index) : idFor(beat.id, index, `_l${n}`),
                x: r.x + r.w / 2,
                y: top + n * lead,
                text: line,
                size: 30,
                ...(item.tone ? { tone: item.tone } : {}),
              }));
            }
            const size = narrow ? 27 : 36;
            const lines = narrow ? wrapText(item.text, r.w, size) : [item.text];
            // Wide enough that the overlap solver does not read two
            // consecutive lines as a collision and shrink the point until it
            // fits a gap that was never there.
            const lead = handLead(size);
            const top = r.y + size * 0.9;
            // Each line waits for the one above it — a person writes a second
            // line after the first, not alongside it — and waits exactly as
            // long as that line takes, which only the shared ruler knows.
            return lines.map((line, n) => ({
              kind: 'handwrite',
              ...(n > 0 ? { after: afterLines(lines, n) } : {}),
              id: n === 0 ? idFor(beat.id, index) : idFor(beat.id, index, `_l${n}`),
              x: r.x + r.w / 2,
              y: narrow ? top + n * lead : r.y + Math.min(WRITE_H, r.h) * 0.7,
              text: line,
              size: narrow ? size : fitText(item.text, r.w * 0.94, 36, 17),
              ...(item.tone ? { tone: item.tone } : {}),
            }));
          },
        });
        i += 1;
        break;
      }

      case 'list': {
        const { heading, items: listItems, tone } = item;
        // As wide as a note, because both are read rather than glanced at, and
        // a line of text that runs the whole board is a line the eye loses.
        const w = Math.min(WIDTH, WIDTH * 0.82);
        blocks.push({
          kind: item.do,
          at: index,
          height: listBoxHeight(listItems, heading, w),
          place: (r) => [
            {
              kind: 'list',
              id: idFor(beat.id, index),
              x: r.x + (r.w - Math.min(w, r.w)) / 2,
              y: r.y,
              w: Math.min(w, r.w),
              ...(heading ? { heading } : {}),
              items: listItems.map((it) => ({ ...it })),
              ...(tone ? { tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'note': {
        const text = item.text;
        const tone = item.tone;
        blocks.push({
          kind: item.do,
          at: index,
          height: noteHeight(text, WIDTH * 0.68),
          place: (r) => {
            const w = Math.min(r.w, WIDTH * 0.68);
            return [
              {
                kind: 'note',
                id: idFor(beat.id, index),
                // Its own rectangle's middle, for the equation's reason above.
                x: r.x + (r.w - w) / 2,
                y: r.y,
                w,
                text,
                ...(tone ? { tone } : {}),
              },
            ];
          },
        });
        i += 1;
        break;
      }

      case 'card': {
        // Gather the run of cards; they are one row, not three blocks.
        const run: Extract<Instruction, { do: 'card' }>[] = [];
        while (i < items.length && items[i].do === 'card') {
          run.push(items[i] as Extract<Instruction, { do: 'card' }>);
          i += 1;
        }
        const perRow = Math.max(1, Math.min(run.length, Math.floor(WIDTH / MIN_CARD_W)));
        const rows = Math.ceil(run.length / perRow);
        blocks.push({
          kind: item.do,
          at: index,
          height: rows * CARD_H + (rows - 1) * GUTTER,
          place: (r) => {
            const out: Element[] = [];
            const cardW = (r.w - (perRow - 1) * GUTTER) / perRow;
            run.forEach((card, n) => {
              const row = Math.floor(n / perRow);
              const col = n % perRow;
              const x = r.x + col * (cardW + GUTTER);
              const y = r.y + row * (CARD_H + GUTTER);
              // A card is a box plus its body line, and the box's own label is
              // left empty: the heading is drawn as text so the two never fight
              // for the box's centre — which is exactly how they collided when
              // a model was placing them.
              out.push({
                kind: 'box',
                id: idFor(beat.id, index, `_c${n}`),
                x,
                y,
                w: cardW,
                h: CARD_H,
                label: '',
                ...(card.tone ? { tone: card.tone } : {}),
                ...(card.as ? { as: card.as } : {}),
              });
              // The box is this card's own frame; its heading and body are
              // meant to sit inside it.
              bonds.push({ a: idFor(beat.id, index, `_c${n}`), b: idFor(beat.id, index, `_h${n}`) });
              bonds.push({ a: idFor(beat.id, index, `_c${n}`), b: idFor(beat.id, index, `_b${n}`) });
              out.push({
                kind: 'text',
                id: idFor(beat.id, index, `_h${n}`),
                x: x + cardW / 2,
                y: y + 38,
                text: card.heading,
                // Sized to its own card: a heading wider than the box it sits
                // in runs into the card beside it.
                size: fitText(card.heading, cardW - 24, 19),
              });
              out.push({
                kind: 'text',
                id: idFor(beat.id, index, `_b${n}`),
                x: x + cardW / 2,
                y: y + 78,
                text: card.body,
                size: fitText(card.body, cardW - 24, 16),
              });
            });
            return out;
          },
        });
        break;
      }

      case 'say': {
        // Says no element of its own; it marks where the board pauses for words.
        i += 1;
        break;
      }

      case 'place':
      case 'connect':
      case 'annotate': {
        // A mark on something the SCENE owns is drawn inside the scene block,
        // where that thing's box lives. A mark on anything else — a picture,
        // or a named part inside one — waits for the stacking pass, because a
        // picture does not know its own rectangle until every block in the
        // beat has been counted.
        if (item.do === 'annotate' && !places.some((q) => q.id === item.target)) {
          pendingMarks.push({ at: index, id: idFor(beat.id, index), step: item });
          i += 1;
          break;
        }
        if (sceneEmitted) {
          i += 1;
          break;
        }
        sceneEmitted = true;
        const sceneSteps = items;
        blocks.push({
          kind: 'place',
          // The scene records its own, per instruction, below.
          at: null,
          height: null,
          place: (r) => {
            const { elements: figures, boxes } = layoutScene(places, r, (authorId) => `${beat.id}__${authorId}`);
            const out: Element[] = [...figures];
            // Attribute each figure back to the instruction that placed it, so
            // it can appear on the word that named it rather than all at once.
            for (const box of boxes.values()) {
              const n = sceneSteps.findIndex((it) => it.do === 'place' && it.id === box.id);
              if (n >= 0) byInstruction.set(n, [...(byInstruction.get(n) ?? []), box.elementId]);
            }
            let connectors = 0;
            sceneSteps.forEach((it, n) => {
              if (it.do === 'connect') {
                const made = connectElements(it, boxes, idFor(beat.id, n), connectors);
                // A label may move anywhere around the pair it joins, and no
                // further: see connectionRegion.
                const drawn = [it.from, it.to].map((end) => {
                  const placed = boxes.get(end);
                  const figure = placed && figures.find((f) => f.id === placed.elementId);
                  return figure ? boxOf(figure) : undefined;
                });
                if (drawn[0] && drawn[1]) {
                  const labelId = labelIdFor(idFor(beat.id, n));
                  // The label's own starting point belongs to the region too.
                  // Siblings are nudged clear of one another perpendicular to
                  // their lines, which can start a label just outside the pair
                  // it joins — and a leash that excluded where the label was
                  // BORN was a rule broken before the solver ever ran.
                  const home = made.find((m) => m.id === labelId);
                  const region = home
                    ? union(connectionRegion(drawn[0], drawn[1]), boxOf(home))
                    : connectionRegion(drawn[0], drawn[1]);
                  leashes.push({ id: labelId, region });
                }
                connectors += 1;
                out.push(...made);
                byInstruction.set(n, [...(byInstruction.get(n) ?? []), ...made.map((m) => m.id)]);
              } else if (it.do === 'annotate') {
                const made = annotateElement(it, boxes, idFor(beat.id, n));
                // A mark is MEANT to sit on what it marks; the solver must not
                // push the circle off the thing it is circling.
                const target = boxes.get(it.target);
                if (target) for (const m of made) bonds.push({ a: m.id, b: target.elementId });
                out.push(...made);
                byInstruction.set(n, [...(byInstruction.get(n) ?? []), ...made.map((m) => m.id)]);
              }
            });
            return out;
          },
        });
        i += 1;
        break;
      }

      case 'label': {
        pendingLabels.push({ at: index, id: idFor(beat.id, index), step: item });
        i += 1;
        break;
      }

      case 'point': {
        // Not a block: it moves no geometry, it only decides what is bright.
        focus.push(`${item.ref}#${item.part}`);
        i += 1;
        break;
      }

      case 'sketch': {
        // Waits, like a label does, for the picture to know its rectangle.
        pendingSketch = { at: index, id: idFor(beat.id, index), step: item };
        i += 1;
        break;
      }

      default: {
        // An instruction this engine does not know is SKIPPED, never spun on.
        // The switch used to have no default, and an unknown `do` left `i`
        // untouched — the loop hung for two minutes until a test timed out.
        i += 1;
        break;
      }
    }

    // A held question's options stay on its page, and so does the room under
    // it for the student's working.
    if (gluedItems.has(index) && blocks.length > 0) blocks[blocks.length - 1].glued = true;
    const workFor = workAfter.get(index);
    if (workFor !== undefined) blocks.push(workBlock(workFor, workHeight.get(workFor)!));
  }

  /**
   * A picture with the key points written beside it.
   *
   * This is the shape of a real board when a teacher is working on one figure:
   * the drawing takes most of the space and stays big, and what she says gets
   * written up the side as she says it. Stacked instead, four written lines
   * squeezed a kidney down to a thumbnail — the picture the whole beat was
   * about, reduced to make room for its own captions.
   *
   * Deliberately narrow: exactly one figure, at least one written line, and
   * nothing else in the beat. Any other mixture falls through to the ordinary
   * stack, which is still what most beats want.
   */
  /**
   * What a column arrangement can be built around — and a SCENE is not one.
   *
   * It was tried: three cells with the four tissues listed beside them is the
   * same shape as a heart with its chambers listed, so a scene seemed to
   * belong here. It does not. A picture shrinks gracefully into half a board;
   * a row of placed things with connectors between them does not — at 46% the
   * icons packed together until the connectors ran across them, and the key
   * points beside them spilled past the caption. Two new collisions and a
   * bleed, to keep two things on one page.
   *
   * A scene that shares a beat with a list stacks instead, which means it turns
   * the page. That is the cheaper answer on an endless board, and the one the
   * research argues for: move to clean board rather than pack.
   */
  /** Pages the band under a labelled figure needed, when it turned one. */
  let bandSheets = 1;

  const FIGURE: ReadonlySet<Block['kind']> = new Set(['picture', 'diagram', 'chart', 'flow']);
  const figures = blocks.filter((b) => FIGURE.has(b.kind));
  /** Written under a labelled figure, in the order the beat asked for them. */
  const written = blocks.filter((b) => b.kind === 'list');
  /**
   * What reads well in a narrow column beside a figure.
   *
   * A key point and a list are both things a student READS rather than glances
   * at, and both belong next to the thing they are about — which is how a notes
   * page is laid out: the diagram in one column, what it is made of written
   * down the other. Stacked underneath instead, a four-item list left a heart
   * seventy units tall: the picture the whole beat was about, shrunk to make
   * room for its own caption.
   */
  const beside = blocks.filter((b) => b.kind === 'write' || b.kind === 'list');

  /**
   * A LABELLED PICTURE: the figure centred, its names written in the margins.
   *
   * This is what every labelled diagram in every textbook looks like, and it
   * is the arrangement the leader lines need — a name written on the side its
   * part is on reaches that part with a short line that crosses nothing. Put
   * every name down one side instead and half the lines cross the picture.
   *
   * The figure gives up some width for it. That is the trade the layout is
   * making on purpose: a smaller picture whose parts are all named beats a
   * bigger one the student has to be told about in a sentence somewhere else.
   */
  if (figures.length === 1 && (pendingLabels.length > 0 || pendingSketch !== null)) {
    const MARGIN_GAP = 18;
    const leastMargin = Math.round((WIDTH - MARGIN_GAP * 2) * 0.26);
    const columnW = WIDTH - MARGIN_GAP * 2 - leastMargin * 2;
    const columnX = SIDE + leastMargin + MARGIN_GAP;

    // What she says out loud gets written under what she is saying it about.
    // The band is measured first, because the picture's height is whatever is
    // left once the points have the room they need.
    const bandRoom = MAIN.h + SPARE_BELOW;
    // Lists are written under the figure too, and they are measured before the
    // key points because they are the taller thing: a four-item list is most of
    // a band on its own, and the figure has to know that before it takes a size.
    const listsH = written.reduce((sum, b) => sum + (b.height ?? 0) + BAND_GAP, 0);
    // Wrapped to the room the band actually has: it starts at the figure's
    // edge, not the board's, so a line wrapped to the full width would walk
    // off the right side.
    const bandWidth = WIDTH - leastMargin - MARGIN_GAP;
    const band = planBand(
      pendingWrites.map((point) => point.step.text),
      bandWidth,
      Math.max(0, bandRoom - MIN_FIGURE_H - BAND_GAP - listsH),
    );
    const under = band.height + listsH;
    const figureH = under > 0 ? Math.max(MIN_FIGURE_H, bandRoom - under - BAND_GAP) : MAIN.h;

    current = figures[0].at ?? -1;
    for (const el of figures[0].place({ x: columnX, y: MAIN.y, w: columnW, h: figureH })) {
      emit(el);
    }

    const host = elements.find((el) => el.id === figures[0].ref);
    const hostBox = host ? boxOf(host) : null;

    /**
     * The margins are whatever room is left either side of the picture ITSELF.
     *
     * A square picture in a short column is drawn narrower than the column, and
     * the board beside it is empty. Reserving a fixed 26% margin and leaving
     * that strip blank meant "Right atrium (receives deoxygenated blood)"
     * wrapped onto three lines at 14 units while a hundred units of board sat
     * unused next to it. The names get the room the picture did not take.
     */
    const marginOf = (side: 'left' | 'right'): { w: number; cx: number } => {
      const near = hostBox
        ? side === 'left'
          ? hostBox.x
          : hostBox.x + hostBox.w
        : side === 'left'
          ? columnX
          : columnX + columnW;
      // Floored, because a picture wide enough to leave no margin still has
      // names to write beside it — and the floor has to be the SAME number the
      // centre is worked out from, or the writing is measured for one strip
      // and placed in the middle of another.
      const w = Math.max(
        60,
        side === 'left' ? near - MARGIN_GAP - SIDE : SIDE + WIDTH - (near + MARGIN_GAP),
      );
      return { w, cx: side === 'left' ? SIDE + w / 2 : SIDE + WIDTH - w / 2 };
    };
    const margins = { left: marginOf('left'), right: marginOf('right') };

    /**
     * Each name to the side its part is on, and level with it.
     *
     * Level matters as much as the side: a name written at the top of the
     * margin for a part halfway down draws a long diagonal across the picture,
     * and three of those turn a diagram into a cat's cradle. So a label starts
     * beside its own part and only moves down when the one before it is
     * already there.
     */
    type Pending = (typeof pendingLabels)[number];
    const placedFor = pendingLabels.map((pending) => {
      const box = hostBox ? partBox(pending.step.target, elements) : null;
      return { pending, box };
    });

    // Which side each name goes to. A name whose part could not be found has
    // no side of its own, so it takes whichever is emptier — better than
    // piling every homeless label on the left.
    const sideOf = new Map<Pending, 'left' | 'right'>();
    let leftCount = 0;
    for (const { pending, box } of placedFor) {
      let side: 'left' | 'right';
      // The sketch owns the right-hand room; every name goes left of the
      // picture so nothing shares it.
      if (pendingSketch) {
        side = 'left';
      } else if (box && hostBox) {
        side = box.x + box.w / 2 < hostBox.x + hostBox.w / 2 ? 'left' : 'right';
      } else {
        side = leftCount * 2 <= sideOf.size ? 'left' : 'right';
      }
      if (side === 'left') leftCount += 1;
      sideOf.set(pending, side);
    }

    /**
     * How small the writing has to be for a side to hold all its names.
     *
     * A margin has one column of room, and five names in it at full size is a
     * pile, not a list — and a pile gets crushed further by the overlap solver
     * until nothing is readable. Better to write the whole side a little
     * smaller and have every name legible.
     */
    const sizeFor = (side: 'left' | 'right'): number => {
      const mine = placedFor.filter(({ pending }) => sideOf.get(pending) === side);
      for (const size of [20, 18, 16, 14]) {
        const lead = handLead(size);
        const total = mine.reduce(
          (sum, { pending }) =>
            sum + wrapText(pending.step.text, margins[side].w, size).length * lead + 12,
          0,
        );
        if (total <= figureH) return size;
      }
      return 14;
    };
    const sizes = { left: sizeFor('left'), right: sizeFor('right') };

    const lowest = { left: MAIN.y, right: MAIN.y };
    for (const { pending, box } of placedFor) {
      const side = sideOf.get(pending)!;
      const onLeft = side === 'left';
      const size = sizes[side];
      const lines = wrapText(pending.step.text, margins[side].w, size);
      const lead = handLead(size);
      const height = lines.length * lead;
      /**
       * Written AGAINST the picture, not centred in the margin.
       *
       * The margin is where there is room; it is not where the writing
       * belongs. Centred in it, a short name drifted furthest: "Cornea" ended
       * up ninety units clear of the eye it named, with a long line reaching
       * back across the gap, while a long label sat much closer for no reason
       * a student could see. A person writes the word as near the thing as it
       * fits and draws a short line.
       */
      const widest = Math.max(...lines.map((line) => textWidth(line, size)));
      const edge = hostBox
        ? onLeft
          ? hostBox.x - MARGIN_GAP
          : hostBox.x + hostBox.w + MARGIN_GAP
        : onLeft
          ? SIDE + margins.left.w
          : SIDE + WIDTH - margins.right.w;
      const cx = onLeft
        ? Math.max(SIDE + widest / 2, edge - widest / 2)
        : Math.min(SIDE + WIDTH - widest / 2, edge + widest / 2);

      // Beside its part, then down if that room has gone, then kept on the
      // board.
      const wanted = box ? box.y + box.h / 2 - height / 2 : MAIN.y;
      const top = Math.min(Math.max(wanted, lowest[side]), MAIN.y + figureH - height) + size;
      lowest[side] = top + height - size + 10;

      current = pending.at;
      lines.forEach((line, n) => {
        const id = n === 0 ? pending.id : `${pending.id}_l${n}`;
        emit({
          kind: 'handwrite',
          id,
          x: cx,
          y: top + n * lead,
          text: line,
          size,
          ...(n > 0 ? { after: afterLines(lines, n) } : {}),
          ...(pending.step.tone ? { tone: pending.step.tone } : {}),
        });
        // A name barely moves. The line to its part is drawn from where the
        // name IS, so a label the solver carried across the board would leave
        // its own line pointing out of empty space.
        leashes.push({
          id,
          region: { x: cx - 14, y: top + n * lead - 12, w: 28, h: 24 },
        });
      });

      // The line, from the inner edge of the writing to the near edge of the
      // part, so it points AT the thing rather than through it.
      if (box) {
        const midY = top + ((lines.length - 1) * lead) / 2 - size * 0.32;
        const lineId = `${pending.id}_line`;
        emit({
          kind: 'arrow',
          id: lineId,
          // From the edge of the WRITING. Starting it at the margin's edge
          // left a stretch of blank board between the word and its own line.
          from: { x: onLeft ? cx + widest / 2 + 6 : cx - widest / 2 - 6, y: midY },
          to: { x: onLeft ? box.x : box.x + box.w, y: box.y + box.h / 2 },
          ...(pending.step.tone ? { tone: pending.step.tone } : {}),
        });
        // The line and the name it leaves are meant to touch.
        for (const n of lines.keys()) {
          bonds.push({ a: lineId, b: n === 0 ? pending.id : `${pending.id}_l${n}` });
        }
      }
    }

    /**
     * The sketch: a drawing beside the picture, with an arrow from the part it
     * explains.
     *
     * "Take a long arrow from the water inside the glass and draw tiny
     * particles" — the zoom-in every textbook makes and this board could not,
     * because a page held exactly one figure. It takes the right-hand room
     * (the names go left), sits level with its part, and the arrow leaves the
     * part and lands on the sketch's near edge, so it points AT the drawing
     * rather than through it.
     */
    if (pendingSketch && hostBox) {
      const x = hostBox.x + hostBox.w + MARGIN_GAP;
      const w = Math.max(150, SIDE + WIDTH - x);
      const h = Math.max(120, Math.min(figureH, Math.round(w * 0.8)));
      const part = partBox(pendingSketch.step.from, elements);
      const wanted = part ? part.y + part.h / 2 - h / 2 : MAIN.y;
      const y = Math.min(Math.max(wanted, MAIN.y), MAIN.y + figureH - h);
      const ref = pendingSketch.step.ref;
      current = pendingSketch.at;
      emit({
        kind: 'diagram',
        id: ref,
        x,
        y,
        w,
        h,
        src: `generated/${ref}.svg`,
        alt: ref.replace(/_/g, ' '),
        parts: [],
      });
      if (part) {
        const arrowId = `${pendingSketch.id}_arrow`;
        emit({
          kind: 'arrow',
          id: arrowId,
          from: { x: part.x + part.w * 0.6, y: part.y + part.h / 2 },
          to: { x: x - 4, y: y + h / 2 },
          tone: 'accent',
        });
        bonds.push({ a: arrowId, b: ref });
        bonds.push({ a: arrowId, b: figures[0].ref ?? '' });
      }
    }

    /**
     * And her key points, written under the figure as she says them.
     *
     * Left-aligned at the board's own margin rather than centred: a list of
     * points is written down a board, and a centred line reads as a caption
     * about the picture instead of a note she made while teaching on it.
     */
    const bandLead = handLead(band.size);
    /**
     * From the figure's own left edge, not the board's. Written from the far
     * margin while the picture sat centred, a sentence about the figure began
     * a hundred and fifty units to its left and visually belonged to nothing.
     * A note about a figure starts where the figure starts.
     */
    const bandLeft = hostBox
      ? Math.min(Math.max(SIDE, hostBox.x - MARGIN_GAP), columnX)
      : SIDE;
    let by = MAIN.y + figureH + BAND_GAP;
    /**
     * The band borrows the empty strip below the teaching band, and the caption
     * is where the borrowing stops. Past it, the page turns.
     *
     * It used to just keep going: a labelled heart with three key points and a
     * four-item list wrote down to 668 on a board that ends at 620 — off the
     * bottom of its own page, through the caption on the way.
     */
    const bandBottom = MAIN.y + MAIN.h + SPARE_BELOW;
    let sheet = 0;
    const roomFor = (h: number): void => {
      if (by + h <= bandBottom) return;
      sheet += 1;
      by = MAIN.y;
    };

    pendingWrites.forEach((point, n) => {
      current = point.at;
      const lines = band.lines[n];
      // A held question keeps the room for its working on its own page, so
      // the page turns BEFORE the question when the two do not fit together.
      const asked = [...questionItem].find(([, item]) => item === point.at)?.[0];
      const workH = asked === undefined ? undefined : workHeight.get(asked);
      roomFor(lines.length * bandLead + (workH === undefined ? 0 : POINT_GAP + workH));
      const px = (sheet === 0 ? bandLeft : SIDE) + sheet * PAGE_STRIDE;
      lines.forEach((line, k) => {
        const id = k === 0 ? point.id : `${point.id}_l${k}`;
        const x = px + textWidth(line, band.size) / 2;
        const y = by + band.size + k * bandLead;
        emit({
          kind: 'handwrite',
          id,
          x,
          y,
          text: line,
          size: band.size,
          ...(k > 0 ? { after: afterLines(lines, k) } : {}),
          ...(point.step.tone ? { tone: point.step.tone } : {}),
        });
        // Kept where she wrote it. The solver may nudge a point clear of
        // something, but a key point that wandered up beside the picture is no
        // longer the note she made underneath it.
        leashes.push({ id, region: { x: x - 16, y: y - 12, w: 32, h: 24 } });
      });
      by += lines.length * bandLead + POINT_GAP;
      if (asked !== undefined && workH !== undefined) {
        workRects.set(asked, { x: px, y: by, w: SIDE + WIDTH + sheet * PAGE_STRIDE - px, h: workH });
        by += workH + POINT_GAP;
      }
    });

    /**
     * And the lists, under the key points.
     *
     * Placed here rather than left to the stacker, because this branch ends by
     * emptying the block list — and anything it had not placed itself simply
     * vanished. A list written into a beat with a labelled picture appeared
     * nowhere at all: no error, no gap, just a board missing the half the
     * student was meant to copy down.
     */
    for (const block of written) {
      current = block.at ?? -1;
      roomFor(block.height ?? 0);
      let bottom = by;
      for (const el of block.place({
        x: SIDE + sheet * PAGE_STRIDE,
        y: by,
        w: WIDTH,
        h: block.height ?? 0,
      })) {
        emit(el);
        bottom = Math.max(bottom, boxOf(el).y + boxOf(el).h);
      }
      by = bottom + BAND_GAP;
    }
    bandSheets = sheet + 1;

    // Everything this beat wanted has now been placed by hand.
    blocks.length = 0;
  }

  if (
    figures.length === 1 &&
    figures[0].narrow !== false &&
    beside.length > 0 &&
    // A work area has no ink and does not change what shape the beat is.
    blocks.filter((b) => b.kind !== 'work').length === 1 + beside.length
  ) {
    const GAP = 26;
    // A list needs more of the width than a key point does — it carries a
    // term AND its meaning on every line — so the figure gives some back.
    const wide = beside.some((b) => b.kind === 'list');
    const figureW = Math.round((WIDTH - GAP) * (wide ? 0.46 : 0.6));
    const columnW = WIDTH - GAP - figureW;

    current = figures[0].at ?? -1;
    for (const el of figures[0].place({ x: SIDE, y: MAIN.y, w: figureW, h: MAIN.h })) emit(el);

    // From the top, because points accumulate down a board as they are said —
    // a column that stayed vertically centred would slide everything already
    // written whenever a new line arrived.
    //
    // Each point takes the room it actually takes: placed, measured, and the
    // next one starts below it. Equal slots looked tidier until a point wrapped
    // to three lines and ran into the next one.
    const BETWEEN_POINTS = 16;
    let ry = MAIN.y;
    for (const block of blocks) {
      if (block === figures[0]) continue;
      // The room under a held question, kept in the column it was asked in.
      if (block.kind === 'work') {
        const h = block.height ?? 0;
        block.place({ x: SIDE + figureW + GAP, y: ry, w: columnW, h });
        ry += h + BETWEEN_POINTS;
        continue;
      }
      current = block.at ?? -1;
      let bottom = ry;
      for (const el of block.place({ x: SIDE + figureW + GAP, y: ry, w: columnW, h: WRITE_H })) {
        emit(el);
        bottom = Math.max(bottom, boxOf(el).y + boxOf(el).h);
      }
      ry = bottom + BETWEEN_POINTS;
    }

    blocks.length = 0;
  }

  /**
   * --- stack the blocks down MAIN, turning the page when it runs out ---
   *
   * Filled greedily at each block's MINIMUM height: as long as what is already
   * on this page plus the next block's floor still fits the band, it goes on
   * this page. The moment it does not, the page ends and the next one starts.
   * Nothing is ever compressed to make it fit, because the thing that gives way
   * on an endless board is the page count, not the writing.
   */
  const leastOf = (b: Block): number => b.height ?? MIN_FLEXIBLE_H;
  const sheets: Block[][] = [[]];
  let taken = 0;
  for (const block of blocks) {
    const here = sheets[sheets.length - 1];
    const gutter = here.length > 0 ? GUTTER : 0;
    if (here.length > 0 && taken + gutter + leastOf(block) > MAIN.h) {
      // A glued block takes what it is glued to onto the new page with it:
      // a held question, its options and the room under it are one piece.
      const chain: Block[] = [block];
      while (chain[0].glued && here.length > 0) chain.unshift(here.pop()!);
      const onto = here.length === 0 ? here : (sheets.push([]), sheets[sheets.length - 1]);
      onto.push(...chain);
      taken = chain.reduce((sum, b, k) => sum + leastOf(b) + (k > 0 ? GUTTER : 0), 0);
      continue;
    }
    here.push(block);
    taken += gutter + leastOf(block);
  }

  sheets.forEach((sheet, sheetIndex) => {
    if (sheet.length === 0) return;
    const dx = sheetIndex * PAGE_STRIDE;
    const fixed = sheet.reduce((sum, b) => sum + (b.height ?? 0), 0);
    const flexible = sheet.filter((b) => b.height === null).length;
    const gutters = Math.max(0, sheet.length - 1) * GUTTER;
    const spare = Math.max(0, MAIN.h - fixed - gutters);
    // Never below the floor: a flexible block that cannot have its floor here
    // was already moved to a page where it can.
    const flexH = flexible > 0 ? Math.max(MIN_FLEXIBLE_H, spare / flexible) : 0;

    // With no flexible block the stack is shorter than MAIN, so centre it
    // rather than leaving all the empty space at the bottom — but never above
    // the band, however tall the stack turned out.
    const stackH = fixed + gutters + flexible * flexH;
    let y = MAIN.y + (flexible === 0 ? Math.max(0, (MAIN.h - stackH) / 2) : 0);

    for (const block of sheet) {
      const h = block.height ?? flexH;
      // Back to the word that asked for this block, so what emit records is
      // where the tutor actually was when she drew it.
      current = block.at ?? -1;
      for (const el of block.place({ x: SIDE + dx, y, w: WIDTH, h })) emit(el);
      y += h + GUTTER;
    }
  });
  const sheetsUsed = Math.max(1, sheets.filter((s) => s.length > 0).length, bandSheets);

  // --- mark the things the scene does not own ---
  //
  // A picture now knows its rectangle, so a circle round the cortex can be
  // worked out: the part's fractional box, scaled into the picture's box. This
  // is the move that lets ONE picture carry a whole stretch of teaching — she
  // marks it, writes beside it, and never needs another image.
  for (const pending of pendingMarks) {
    const box = partBox(pending.step.target, elements);
    if (!box) continue;
    const { elementId } = splitPartRef(pending.step.target);
    const host = elements.find((el) => el.id === elementId);
    if (!host) continue;

    const grow = pending.step.mark === 'underline' ? 0 : 10;
    current = pending.at;
    emit({
      kind: 'mark',
      id: pending.id,
      x: box.x - grow,
      y: box.y - grow,
      w: box.w + grow * 2,
      h: box.h + grow * 2,
      shape: pending.step.mark,
      ...(pending.step.tone ? { tone: pending.step.tone } : {}),
    });
    bonds.push({ a: pending.id, b: host.id });
  }

  // Nothing on the board sits on anything else.
  //
  // The stacking rules already keep blocks apart; this catches the things drawn
  // BETWEEN and OVER them — a connector's label, a mark — which follow whatever
  // they refer to and so can land anywhere. Fixing those case by case fixes one
  // lesson at a time; this fixes every lesson.
  //
  // The work areas go in as OBSTACLES — frames with no words, which the solver
  // never moves — so a label it nudges cannot settle in the room kept for the
  // student's working. They come out again before anything is returned.
  const WORK_PREFIX = '__work_area_';
  const obstacles: Element[] = [...workRects].map(([n, r]) => ({
    kind: 'box',
    id: `${WORK_PREFIX}${n}`,
    ...r,
    label: '',
  }));
  const settled = resolveOverlaps([...elements, ...obstacles], bonds, [
    // A label's first room is MAIN, where its scene lives. The whole canvas
    // was once its playground, and a stuck label got parked above the lesson
    // title — clear space, wrong room.
    { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: MAIN.h + 20 },
    // When MAIN is genuinely full, everything below the title is fair — a
    // label near the caption reads as a footnote; one over the heading reads
    // as a mistake.
    { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: CANVAS_H - MAIN.y },
  ], leashes).filter((el) => !el.id.startsWith(WORK_PREFIX));

  // A part can only be pointed at if its picture is on the board this beat.
  const shown = new Set(show);
  const keptFocus = focus.filter((f) => shown.has(f.split('#')[0]));

  /**
   * FROM ITEMS BACK TO BOARD INSTRUCTIONS, before reveal reads anything.
   *
   * Reveal walks `beat.board` and asks what each board instruction drew. An
   * ask with options is ONE board instruction and TWO items (the question and
   * the lettered list), so keyed by item every instruction after it answered
   * for its neighbour: the options were never shown, and the next key point
   * came one line late or not at all.
   */
  const byBoard = new Map<number, string[]>();
  for (const [item, ids] of byInstruction) {
    const n = origin[item] ?? item;
    byBoard.set(n, [...(byBoard.get(n) ?? []), ...ids]);
  }

  return {
    elements: settled,
    laid: { show, focus: keptFocus },
    steps: revealSteps(beat, byBoard, keptFocus),
    bonds,
    leashes,
    pages: sheetsUsed,
    asks: asks.map((a, n) => {
      const r = workRects.get(n);
      if (!r) return a;
      return { ...a, workArea: { id: `${idFor(beat.id, questionItem.get(n)!)}_work`, ...r } };
    }),
  };
}

/**
 * Split a beat into the moments its words divide it into.
 *
 * Everything written after a `say` arrives while that line is spoken, so the
 * board fills in with the sentence instead of appearing finished before the
 * tutor has opened her mouth. A beat with no `say` is one moment, and its whole
 * board arrives together — which is right for a beat that is one breath.
 *
 * `show` is cumulative because it is a complete set, not a delta: the board at
 * any moment is everything said so far, which is also what makes any moment
 * recallable on its own.
 *
 * AN ASK ENDS WHAT ITS MOMENT SHOWS. The player holds on the moment that asks
 * until the student answers, so whatever the beat writes after the ask — the
 * working, the answer — is held back and arrives with the NEXT line, after the
 * answer. Revealed with the ask instead, it was the answer on the board during
 * the hold (b3 of the first maths class showed "Solution: x = 49/29, y =
 * 19/29" while asking how to find x). When no line follows the ask, that ink
 * gets a trailing moment of its own with EMPTY narration: nothing is said over
 * it, and the assembler decides what an unspoken moment becomes.
 *
 * "The next line" means the line that opens a LATER moment than the one the
 * ask is held on. An ask written before the first word is pinned to the first
 * line's moment (layoutBeat: `Math.max(0, saysSeen - 1)`), so that first line
 * does not release what waits — releasing it there put the answer back on the
 * held board. And a beat that asks but never says a line is split the same
 * way: its one spoken moment (the beat's own narration) shows the board up to
 * the ask, and what follows the ask goes in the trailing unspoken moment.
 */
function revealSteps(
  beat: ScriptBeat,
  byBoard: ReadonlyMap<number, string[]>,
  focus: readonly string[],
): RevealStep[] {
  const says = beat.board.filter((it) => it.do === 'say');
  const asks = beat.board.some((it) => it.do === 'ask');
  if (says.length === 0 && !asks) {
    return [
      {
        narration: beat.narration,
        show: [...new Set([...byBoard.values()].flat())],
        focus: [...focus],
      },
    ];
  }

  const steps: RevealStep[] = [];
  const cumulative: string[] = [];
  // A beat with no line of its own speaks its narration over its one moment,
  // which is open from the first board instruction.
  let narration: string | null = says.length === 0 ? beat.narration : null;
  /**
   * The moment an ask is held on, by the index it will have in `steps`; null
   * while nothing is held. Ink drawn while it is set waits for the answer.
   * Before the first word that index is 0, the first line's moment, which is
   * also `steps.length` then — so one expression serves both cases.
   */
  let heldAt: number | null = null;
  const waiting: string[] = [];
  /** Board instructions drawn before the first word, which every moment shows. */
  const early: string[] = [];

  const add = (ids: readonly string[]): void => {
    for (const id of ids) if (!cumulative.includes(id)) cumulative.push(id);
  };
  const flush = (): void => {
    if (narration === null) return;
    steps.push({ narration, show: [...cumulative], focus: [] });
  };

  beat.board.forEach((item, n) => {
    if (item.do === 'say') {
      flush();
      narration = item.text;
      // The line opens moment `steps.length`. Only a moment AFTER the held one
      // lets the waiting ink in.
      if (heldAt !== null && steps.length > heldAt) {
        heldAt = null;
        add(waiting.splice(0));
      }
      return;
    }
    const ids = byBoard.get(n) ?? [];
    if (heldAt !== null) {
      waiting.push(...ids);
      return;
    }
    add(ids);
    if (narration === null) early.push(...ids);
    if (item.do === 'ask') heldAt = steps.length;
  });
  flush();
  if (waiting.length > 0) {
    add(waiting);
    steps.push({ narration: '', show: [...cumulative], focus: [] });
  }

  // Anything drawn before the first word still belongs on the board from the
  // start — a title written above the scene should not wait for a sentence.
  if (steps.length > 0) {
    for (const step of steps) {
      for (const id of early) if (!step.show.includes(id)) step.show.unshift(id);
    }
    // The beat's emphasis belongs to its last SPOKEN moment, where the point
    // is made — not to the unspoken trailing one, which has no line of the
    // planner's to make it over.
    let last = steps.length - 1;
    while (last > 0 && steps[last].narration.trim() === '') last -= 1;
    steps[last].focus = [...focus];
  }
  return steps;
}

/**
 * Move a laid-out element sideways, whatever shape its geometry takes.
 *
 * This is what turns one board into an endless one: each beat is laid out in
 * page-local coordinates — where every band rule and overlap guarantee holds —
 * and then the whole page is slid to its slot on the plane.
 */
export function offsetElement(el: Element, dx: number): Element {
  if (dx === 0) return el;
  switch (el.kind) {
    case 'arrow':
      return {
        ...el,
        from: { x: el.from.x + dx, y: el.from.y },
        to: { x: el.to.x + dx, y: el.to.y },
      };
    case 'pen':
      return { ...el, points: el.points.map((pt) => ({ x: pt.x + dx, y: pt.y })) };
    default:
      return { ...el, x: el.x + dx };
  }
}

/** The board is this tall and no taller; exported so callers can assert it. */
export const BOARD = { w: CANVAS_W, h: CANVAS_H, TOP, MAIN, BOTTOM, SIDE, GUTTER };
