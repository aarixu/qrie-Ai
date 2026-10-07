import {
  boxOf,
  overlaps,
  union,
  noteBoxHeight,
  splitPartRef,
  type ImagePart,
  type Rect,
  CANVAS_H,
  CANVAS_W,
  fitHand,
  fitText,
  handWidth,
  writeMs,
  PAGE_STRIDE,
  wrapHand,
  wrapLines,
  listBoxHeight,
  listItemBox,
  compileFunction,
  isToolName,
  toolAspect,
  toolMinSize,
  type Element,
  type Beat,
} from '@ai-tutor/lesson-format';
import type { Instruction, LaidOutBeat, ScriptBeat, ToolInstruction } from './types';
import {
  annotateElement,
  connectElements,
  connectionRegion,
  labelIdFor,
  layoutScene,
} from './scene';
import { resolveOverlaps, type Bond, type Leash } from './collide';
import {
  ARRANGEMENTS,
  arrangementOf,
  coverage,
  fillRegions,
  FILL_GAP,
  inTwoColumns,
  isMainKind,
  PAGE,
  writtenArea,
  type Fillable,
  type SheetReport,
} from './compose';
import { inksFor, paintInks } from './ink';

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
/** A derivation's line pitch, how many steps a page takes, and how far apart they arrive. */
const DERIVE_LEAD = 44;
const MAX_DERIVE_STEPS = 7;
const DERIVE_STEP_MS = 1400;
const WRITE_H = 62;
const CARD_H = 128;
/** The sizes a card's body may wrap at, largest first; see the card block. */
const CARD_BODY_SIZES = [16, 15, 14, 13];
/**
 * A summary's words: size, line pitch, and the room the banner's notches take
 * at each end. 20 because on a composed page the summary is written on the
 * page's last line, whose frame is the whole page (1102 wide at 16:9), and 20
 * units there is 12px on a phone. Two lines of it fill an 80-unit summary place.
 */
const SUMMARY_SIZE = 20;
const SUMMARY_LEAD = 28;
const SUMMARY_NOTCH = 28;
/**
 * A comparison: its inner padding, headings, points and their line pitch. A
 * padding of 12 keeps three one-line rows (144 tall) inside the 148-unit band
 * under a composed figure (compose.ts).
 */
const COMPARE_PAD = 12;
const COMPARE_HEAD = 19;
const COMPARE_SIZE = 16;
const COMPARE_LEAD = 22;
/**
 * No wider than this: framed whole on a phone, a comparison across the full
 * board set its 16-unit points at 10.7px (the composer demo, 2026-10-04); at
 * 680 they read at 12px or more.
 */
const COMPARE_MAX_W = 680;

/**
 * A connector's words lifted above their row (the scene block): written no
 * larger than LANE_SIZE, LANE_CLEAR above the tallest thing they span, and —
 * when the row reached the top of its band — in a LANE that tall kept clear
 * above it. 42 holds a size-20 line (27 tall, `boxOf`) with its clearance
 * under it and the solver's breathing room over it.
 */
const LANE = 42;
const LANE_SIZE = 20;
const LANE_CLEAR = 8;
/** A label's box with the room the solver wants round it (collide.ts BREATHING). */
const padLabel = (r: Rect): Rect => ({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 });
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
 * A key point on a composed page: smaller than a stacked board's 27, because
 * the camera comes close to the region being taught (assemble frames it), and
 * the page has more to hold.
 */
const POINT_SIZE = 22;
/** How far a composed key point's words start from its region's left edge: the bullet's margin. */
const BULLET_INDENT = 32;
/** The gap between a composed scene's rows: a lane, room for an arrow's words beside it. */
const COMPOSED_ROW_GAP = 44;
/** A part's name in the key under a picture, its part not found: the size of a name in the margin. */
const HOMELESS_NAME_SIZE = 20;
/** The key under a picture: the gap above it, a bullet's room before each name, and the room between names. */
const KEY_GAP = 12;
const KEY_DOT_W = 26;
const KEY_ITEM_GAP = 28;

/** Names in rows no wider than `w`, each name with its bullet; a row's width is what its names take. */
function keyRowsOf(texts: readonly string[], w: number): { items: { index: number; w: number }[]; w: number }[] {
  const rows: { items: { index: number; w: number }[]; w: number }[] = [];
  texts.forEach((text, index) => {
    const width = handWidth(text, HOMELESS_NAME_SIZE);
    const row = rows[rows.length - 1];
    const wider = row ? row.w + KEY_ITEM_GAP + KEY_DOT_W + width : Infinity;
    if (row && wider <= w) {
      row.items.push({ index, w: width });
      row.w = wider;
    } else {
      rows.push({ items: [{ index, w: width }], w: KEY_DOT_W + width });
    }
  });
  return rows;
}

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
  kind: Instruction['do'];
  /** The artwork this block places, when it places artwork. */
  ref?: string;
  /** Fixed height, or null to share whatever is left over. */
  height: number | null;
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
  /**
   * Its height when drawn `w` wide, for a block that cannot be drawn just to
   * be measured: a card, a summary and a comparison record bonds as they are
   * placed, so drawing one to measure it would record them twice. A block
   * without one is measured by drawing it (the composed page, compose.ts).
   */
  heightAt?: (w: number) => number;
}

const idFor = (beatId: string, index: number, suffix = ''): string =>
  `${beatId}_${index}${suffix}`;

/** A tool instruction's params: every key but the ones the board itself reads. */
export function toolParamsOf(item: ToolInstruction): Record<string, unknown> {
  const { do: _do, id: _id, at: _at, ...params } = item;
  return params;
}

/**
 * How long into a spoken line she reaches `word`: its place in the line at
 * about 14 characters a second, the rate a teacher's Hinglish line was
 * measured at (relay vertexSpeech: 56 characters in 4.4 s). 0 when the line
 * does not hold the word.
 */
const SPOKEN_MS_PER_CHAR = 1000 / 14;
function anchorMs(said: string, word: string): number {
  const at = said.toLowerCase().indexOf(word.trim().toLowerCase());
  return at > 0 ? Math.round(at * SPOKEN_MS_PER_CHAR) : 0;
}

/**
 * Where a mark on a line she wrote goes: round all its lines, or only round
 * `span` — the first of its lines that holds those words, from where they
 * start in it to where they end. Measured with the ruler the line was laid
 * out with (her hand, `handWidth`); a formula is evenly spaced, so a share of
 * its width. A line with typeset maths, or a span no line holds, marks the
 * whole.
 */
function markedBox(lines: readonly Element[], span?: string): Rect | null {
  if (lines.length === 0) return null;
  const whole = lines.map(boxOf).reduce(union);
  const wanted = span?.trim().toLowerCase();
  if (!wanted) return whole;
  for (const line of lines) {
    if (line.kind !== 'handwrite' && line.kind !== 'formula') continue;
    if (/\$/.test(line.text)) continue;
    const at = line.text.toLowerCase().indexOf(wanted);
    if (at < 0) continue;
    const b = boxOf(line);
    if (line.kind === 'formula') {
      const share = b.w / Math.max(1, line.text.length);
      return { x: b.x + at * share, y: b.y, w: wanted.length * share, h: b.h };
    }
    const size = line.size ?? 26;
    return {
      x: b.x + handWidth(line.text.slice(0, at), size),
      y: b.y,
      w: handWidth(line.text.slice(at, at + wanted.length), size),
      h: b.h,
    };
  }
  return whole;
}

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
 * Her handwriting, wrapped to a column, keeping a little of it clear.
 *
 * The BREAKING is `wrapHand` in lesson-format, beside the width measurement it
 * is made of — this file used to carry its own copy that guessed half an em per
 * character, packed more onto a line than would fit, and ran text past the very
 * margin it was wrapping for. Every caller writes in her hand (a key point, a
 * picture's name), so it is measured as Caveat, not as the sans board text.
 *
 * The six percent held back is the only part that belongs here: a board is not
 * a page, and text that reaches the edge of its column reads as though it ran
 * out of room.
 */
function wrapText(text: string, w: number, size: number): string[] {
  return wrapHand(text, w * 0.94, size);
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
  /**
   * `composed`: lay the page out in regions (compose.ts) rather than as one
   * stack. Off unless the plan asks for it, so every plan made before the
   * composer, and every fixture, is laid out exactly as it was.
   */
  opts: { composed?: boolean } = {},
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
  /** The questions this beat stops on, by the index of the say that asks. */
  asks: { step: number; ask: NonNullable<Beat['ask']> }[];
  /**
   * Board instructions that write words and drew nothing — by their index on
   * the board, with the words. Their ink never depends on a picture or its
   * parts, so drawing nothing is always a fault of the layout or of the
   * instruction, never a picture that failed; the keep gate's `drawn` rule
   * reads it.
   */
  undrawn: { index: number; do: Instruction['do']; text: string }[];
  /** Each element's region on a composed page, "<sheet>/<region>" (compose.ts). Empty on a stacked page. */
  regions: Record<string, string>;
  /** How full each page of a composed beat is, and what is on it. Empty on a stacked page. */
  sheets: SheetReport[];
} {
  const elements: Element[] = [];
  const show: string[] = [];
  const focus: string[] = [];
  /** Each `point`, by the item it came from, so a composed board can light it on its own line. */
  const pointAt: { at: number; ref: string }[] = [];
  const blocks: Block[] = [];
  /** Each element's region on a composed page; nothing on a stacked one. */
  const regions: Record<string, string> = {};
  /** The region what is emitted now goes in, or null on a stacked page. */
  let regionNow: string | null = null;

  /**
   * Which element ids each ITEM produced, keyed by the item's index in the
   * list below. Reveal reads by BOARD index, and an ask is a board instruction
   * that is no item at all, so `origin` maps one onto the other before reveal
   * ever sees it (see the end of this function).
   */
  const byInstruction = new Map<number, string[]>();
  let current = -1;
  const emit = (el: Element, focused = false): void => {
    if (regionNow !== null) regions[el.id] = regionNow;
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
   * AN ASK IS A MARKER AND WRITES NOTHING (Aarav, 2026-10-01).
   *
   * She asks out loud and the student answers out loud: no question, no
   * options and no room for working go on the board, which stays hers. The
   * marker records WHICH spoken moment carries the question, for the
   * assembler to pin on the lesson beat the player will hold.
   */
  const asks: { step: number; ask: NonNullable<Beat['ask']> }[] = [];
  const items: Instruction[] = [];
  /** The board index each item came from: `origin[item] = board index`. */
  const origin: number[] = [];
  /** The spoken line each item is drawn under: how many says came before it. */
  const lineOf: number[] = [];
  /** What each spoken line says, in order: `saidLines[lineOf[item] - 1]`. */
  const saidLines: string[] = [];
  let saysSeen = 0;
  beat.board.forEach((step, boardIndex) => {
    if (step.do === 'say') {
      saysSeen += 1;
      saidLines.push(step.text);
    }
    if (step.do !== 'ask') {
      items.push(step);
      origin.push(boardIndex);
      lineOf.push(saysSeen);
      return;
    }
    asks.push({
      step: Math.max(0, saysSeen - 1),
      ask: {
        question: step.question,
        ...(step.written ? { written: step.written } : {}),
        ...(step.options ? { options: step.options } : {}),
        ...(step.expect ? { expect: step.expect } : {}),
        ...(step.hint ? { hint: step.hint } : {}),
      },
    });
  });

  /**
   * THE COMPOSED PAGE (compose.ts), decided before anything is drawn, because
   * a composed page writes its title, its captions and its key points
   * differently. A page with two main demonstrations stays a stack, exactly as
   * before.
   */
  const arranged = opts.composed ? arrangementOf(items.map((it) => it.do)) : 'fallback';
  // Names and insets are drawn round a figure only. On any other composed page
  // they would have nowhere to go, so that page keeps the stack, which draws
  // them, rather than lose what the planner wrote.
  const arrangement =
    arranged !== 'figure' && items.some((it) => it.do === 'label' || it.do === 'sketch') ? 'fallback' : arranged;
  const composition = arrangement === 'fallback' ? null : ARRANGEMENTS[arrangement];

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
  /**
   * The item each written line came from, by the `id` the planner gave it, so
   * a later `annotate` can mark what she wrote (canvas C3).
   */
  const writtenAt = new Map<string, number>();
  /** The item each list came from, by its `id`, so a later `annotate` can mark one of its items. */
  const listAt = new Map<string, number>();
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const index = i;
    current = i;
    if ((item.do === 'write' || item.do === 'equation') && item.id) writtenAt.set(item.id, index);
    if (item.do === 'list' && item.id) listAt.set(item.id, index);

    switch (item.do) {
      case 'title': {
        if (composition) {
          // The header: where this sits in the chapter, small, over the
          // title, both above PAGE.top so nothing is filled over them. A
          // sub-title has no room here and is not written.
          regionNow = '0/header';
          emit({ kind: 'title', id: idFor(beat.id, index), x: CANVAS_W / 2, y: PAGE.titleY, text: item.text });
          if (item.path && item.path.length > 0) {
            emit({
              kind: 'text',
              id: idFor(beat.id, index, '_path'),
              x: CANVAS_W / 2,
              y: PAGE.crumbY,
              text: item.path.join(' › '),
              // 20, not smaller: the breadcrumb is often seen only in the
              // page's pull-out, framed 1102 wide, and 20 units there is
              // 12px on a phone (gate, phone-readable).
              size: PAGE.crumbSize,
              muted: true,
            });
          }
          regionNow = null;
          i += 1;
          break;
        }
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
        if (composition) {
          // Written where a key point would be, at a size its region holds.
          blocks.push({
            kind: item.do,
            at: index,
            height: 34,
            place: (r) => [
              { kind: 'text', id: idFor(beat.id, index), x: r.x + r.w / 2, y: r.y + 24, text: item.text, size: fitText(item.text, r.w - 8, 20) },
            ],
          });
          i += 1;
          break;
        }
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

      case 'plot': {
        // A formula this cannot compute draws nothing, and `undrawn` says so.
        if (compileFunction(item.fn) === null || !(item.from < item.to)) {
          i += 1;
          break;
        }
        blocks.push({
          kind: item.do,
          at: index,
          height: null,
          // No wider than a graph reads well: a curve stretched across the
          // whole board is a line, not a shape.
          place: (r) => {
            const w = Math.min(r.w, r.h * 1.8);
            return [
              {
                kind: 'plot',
                id: idFor(beat.id, index),
                x: r.x + (r.w - w) / 2,
                y: r.y,
                w,
                h: r.h,
                fn: item.fn,
                from: item.from,
                to: item.to,
                ...(item.caption ? { caption: item.caption } : {}),
                ...(item.x ? { xLabel: item.x } : {}),
                ...(item.y ? { yLabel: item.y } : {}),
                ...(item.tone ? { tone: item.tone } : {}),
              },
            ];
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

      case 'derive': {
        const steps = item.steps.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_DERIVE_STEPS);
        if (steps.length === 0) {
          i += 1;
          break;
        }
        blocks.push({
          kind: item.do,
          at: index,
          height: steps.length * DERIVE_LEAD + 10,
          // The equals signs in one column, the block centred on it in the
          // rectangle it was given. Measured as the board measures a formula
          // (an evenly spaced line), so the column is the board's own.
          place: (r) => {
            const ruler = (text: string) => boxOf({ kind: 'formula', id: '_', x: 0, y: 0, text }).w;
            const widths = steps.map(ruler);
            const lefts = steps.map((s, n) => {
              const eq = s.indexOf('=');
              return eq < 0 ? widths[n] / 2 : (widths[n] * (eq + 0.5)) / s.length;
            });
            const left = Math.max(...lefts);
            const right = Math.max(...widths.map((w, n) => w - lefts[n]));
            const column = r.x + (r.w - (left + right)) / 2 + left;
            return steps.map((text, n) => ({
              kind: 'formula' as const,
              id: n === 0 ? idFor(beat.id, index) : idFor(beat.id, index, `_l${n}`),
              x: column - lefts[n] + widths[n] / 2,
              y: r.y + DERIVE_LEAD * (n + 0.7),
              text,
              ...(n > 0 ? { after: n * DERIVE_STEP_MS } : {}),
            }));
          },
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
        const wideFit = fitHand(item.text, WIDTH * 0.94, 36, 17);
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
            const narrow = composition !== null || r.w < WIDTH * 0.75;
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
            const size = narrow ? (composition ? POINT_SIZE : 27) : 36;
            // On a composed page a key point is a bullet point (Aarav,
            // 2026-10-04): written from the left of its region, the bullet in
            // a margin of its own, and a wrapped line under the point's words
            // rather than under the bullet. Centred, a wrapped point read as
            // two notes.
            const indent = composition ? BULLET_INDENT : 0;
            const lines = narrow ? wrapText(item.text, r.w - indent, size) : [item.text];
            // Wide enough that the overlap solver does not read two
            // consecutive lines as a collision and shrink the point until it
            // fits a gap that was never there.
            const lead = handLead(size);
            const top = r.y + size * 0.9;
            // Each line waits for the one above it — a person writes a second
            // line after the first, not alongside it — and waits exactly as
            // long as that line takes, which only the shared ruler knows.
            const written: Element[] = lines.map((line, n) => ({
              kind: 'handwrite',
              ...(n > 0 ? { after: afterLines(lines, n) } : {}),
              id: n === 0 ? idFor(beat.id, index) : idFor(beat.id, index, `_l${n}`),
              x: composition ? r.x + indent + handWidth(line, size) / 2 : r.x + r.w / 2,
              y: narrow ? top + n * lead : r.y + Math.min(WRITE_H, r.h) * 0.7,
              text: line,
              size: narrow ? size : fitHand(item.text, r.w * 0.94, 36, 17),
              ...(item.tone ? { tone: item.tone } : {}),
            }));
            if (!composition) return written;
            // The bullet, level with the first line and clear of it by more
            // than the overlap solver's breathing room.
            return [{ kind: 'text', id: idFor(beat.id, index, '_dot'), x: r.x + 10, y: top, text: '•', size }, ...written];
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
        // As many to a row as the rectangle holds at MIN_CARD_W each. On the
        // full width that is the same three it always was.
        const perRowAt = (w: number): number => Math.max(1, Math.min(run.length, Math.floor(w / MIN_CARD_W)));
        const heightAt = (w: number): number => {
          const rows = Math.ceil(run.length / perRowAt(w));
          return rows * CARD_H + (rows - 1) * GUTTER;
        };
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const out: Element[] = [];
            const perRow = perRowAt(r.w);
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
              /**
               * THE BODY WRAPS INSIDE ITS CARD.
               *
               * It was one line, shrunk to size 12 and then left wider than
               * the card: three forty-character bodies in a row ran past
               * their frames into the next card, and a text element is not
               * something the solver can move (canvas audit 2026-10-01, item
               * 5). A body that fits one line at size 15 or more is drawn
               * exactly as before; a longer one wraps at the largest size
               * that keeps it to three lines, never below 13. Four lines at 13
               * still end inside the 128-unit card; a body that needs five or
               * more runs past its foot, and nothing here stops that.
               */
              const room = cardW - 28;
              const oneLine = fitText(card.body, cardW - 24, 16);
              const size =
                oneLine >= 15 ? oneLine : (CARD_BODY_SIZES.find((s) => wrapLines(card.body, room, s).length <= 3) ?? 13);
              const lines = oneLine >= 15 ? [card.body] : wrapLines(card.body, room, size);
              // A text line's box is 1.35 of its size tall (boxOf), so lines
              // any closer than this would read as touching.
              const lead = size * 1.4;
              // Centred on the line a one-line body sits on, and never up into
              // the heading above it.
              const first = Math.max(y + 64, y + 78 - ((lines.length - 1) * lead) / 2);
              lines.forEach((line, k) => {
                const lineId = idFor(beat.id, index, k === 0 ? `_b${n}` : `_b${n}_l${k}`);
                if (k > 0) bonds.push({ a: idFor(beat.id, index, `_c${n}`), b: lineId });
                out.push({
                  kind: 'text',
                  id: lineId,
                  x: x + cardW / 2,
                  y: lines.length === 1 ? y + 78 : first + k * lead,
                  text: line,
                  size,
                });
              });
            });
            return out;
          },
        });
        break;
      }

      case 'summary': {
        const text = item.text;
        // No wider than a note: a one-line takeaway stretched across the
        // whole board reads as a banner ad, not a note.
        const widthAt = (w: number): number => Math.min(w, WIDTH * 0.7);
        const linesAt = (w: number): string[] => wrapLines(text, widthAt(w) - SUMMARY_NOTCH * 2, SUMMARY_SIZE);
        const heightAt = (w: number): number => linesAt(w).length * SUMMARY_LEAD + 22;
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const w = widthAt(r.w);
            const x = r.x + (r.w - w) / 2;
            const lines = linesAt(r.w);
            const frameId = idFor(beat.id, index);
            const out: Element[] = [
              { kind: 'box', id: frameId, x, y: r.y, w, h: heightAt(r.w), label: '', as: 'banner', tone: 'accent' },
            ];
            lines.forEach((line, k) => {
              const id = idFor(beat.id, index, `_s${k}`);
              // The words are meant to sit inside their banner.
              bonds.push({ a: frameId, b: id });
              out.push({ kind: 'text', id, x: x + w / 2, y: r.y + 11 + SUMMARY_SIZE + k * SUMMARY_LEAD, text: line, size: SUMMARY_SIZE });
            });
            return out;
          },
        });
        i += 1;
        break;
      }

      case 'compare': {
        const { left, right } = item;
        const fair = (side: unknown): side is { heading: string; points: string[] } =>
          typeof side === 'object' &&
          side !== null &&
          typeof (side as { heading?: unknown }).heading === 'string' &&
          Array.isArray((side as { points?: unknown }).points) &&
          (side as { points: unknown[] }).points.length >= 2 &&
          (side as { points: unknown[] }).points.length <= 6;
        // Two to six points a side, or nothing at all: `undrawn` names it.
        if (!fair(left) || !fair(right)) {
          i += 1;
          break;
        }
        // As wide as its rectangle, up to COMPARE_MAX_W, and centred in it.
        const widthOf = (w: number): number => Math.min(w, COMPARE_MAX_W);
        const columnAt = (w: number): number => (widthOf(w) - COMPARE_PAD * 3) / 2;
        const rowsAt = (w: number): { left: string[]; right: string[]; h: number }[] =>
          Array.from({ length: Math.max(left.points.length, right.points.length) }, (_, n) => {
            const l = left.points[n] ? wrapLines(left.points[n], columnAt(w), COMPARE_SIZE) : [];
            const rr = right.points[n] ? wrapLines(right.points[n], columnAt(w), COMPARE_SIZE) : [];
            return { left: l, right: rr, h: Math.max(l.length, rr.length, 1) * COMPARE_LEAD + 8 };
          });
        const heightAt = (w: number): number =>
          COMPARE_PAD * 2 + COMPARE_HEAD * 1.6 + rowsAt(w).reduce((sum, row) => sum + row.h, 0);
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const frameId = idFor(beat.id, index);
            const col = columnAt(r.w);
            const x0 = r.x + (r.w - widthOf(r.w)) / 2;
            const centres = [x0 + COMPARE_PAD + col / 2, x0 + COMPARE_PAD * 2 + col + col / 2];
            const out: Element[] = [{ kind: 'box', id: frameId, x: x0, y: r.y, w: widthOf(r.w), h: heightAt(r.w), label: '' }];
            const write = (id: string, x: number, y: number, text: string, size: number): void => {
              bonds.push({ a: frameId, b: id });
              out.push({ kind: 'text', id, x, y, text, size });
            };
            const headY = r.y + COMPARE_PAD + COMPARE_HEAD;
            write(idFor(beat.id, index, '_lh'), centres[0], headY, left.heading, COMPARE_HEAD);
            write(idFor(beat.id, index, '_rh'), centres[1], headY, right.heading, COMPARE_HEAD);
            let y = r.y + COMPARE_PAD + COMPARE_HEAD * 1.6;
            rowsAt(r.w).forEach((row, n) => {
              row.left.forEach((line, k) => write(idFor(beat.id, index, `_l${n}_${k}`), centres[0], y + COMPARE_SIZE + k * COMPARE_LEAD, line, COMPARE_SIZE));
              row.right.forEach((line, k) => write(idFor(beat.id, index, `_r${n}_${k}`), centres[1], y + COMPARE_SIZE + k * COMPARE_LEAD, line, COMPARE_SIZE));
              y += row.h;
            });
            return out;
          },
        });
        i += 1;
        break;
      }

      case 'say': {
        // Says no element of its own; it marks where the board pauses for words.
        i += 1;
        break;
      }

      case 'newPage': {
        // Draws nothing; the stacker turns the page here (see there).
        blocks.push({ kind: item.do, at: index, height: 0, place: () => [] });
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
            /**
             * The scene, drawn into one band — PURE, so it can be drawn twice
             * and only the version kept leaves anything behind.
             */
            const drawScene = (band: Rect) => {
              const { elements: figures, boxes } = layoutScene(
                places,
                band,
                (authorId) => `${beat.id}__${authorId}`,
                composition ? COMPOSED_ROW_GAP : undefined,
              );
              /**
               * How many earlier arrows run alongside this one: they share an
               * end and point the same way. On a composed board only those push
               * it sideways — every earlier arrow did, and the pancreas's arrow
               * into the lumen was pushed through the lumen's name (small
               * intestine, 2026-10-07). A stacked board counts them all, as it
               * always has.
               */
              const centre = (id: string) => {
                const p = boxes.get(id);
                return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : null;
              };
              const alongside = (step: Extract<Instruction, { do: 'connect' }>, before: number): number =>
                sceneSteps.slice(0, before).filter((s) => {
                  if (s.do !== 'connect') return false;
                  const ends = [s.from, s.to];
                  if (!ends.includes(step.from) && !ends.includes(step.to)) return false;
                  const [a, b, c, d] = [centre(step.from), centre(step.to), centre(s.from), centre(s.to)];
                  if (!a || !b || !c || !d) return false;
                  const u = { x: b.x - a.x, y: b.y - a.y };
                  const v = { x: d.x - c.x, y: d.y - c.y };
                  const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) || 1) * (Math.hypot(v.x, v.y) || 1));
                  return Math.abs(cos) > 0.9;
                }).length;
              const out: Element[] = [...figures];
              const attributed: [number, string][] = [];
              const tied: Leash[] = [];
              const meant: Bond[] = [];
              const figureBoxes = figures.map(boxOf);
              /** Labels that sit on a picture and had no room above the row to go to. */
              let stuck = false;
              // Attribute each figure back to the instruction that placed it, so
              // it can appear on the word that named it rather than all at once.
              for (const box of boxes.values()) {
                const n = sceneSteps.findIndex((it) => it.do === 'place' && it.id === box.id);
                if (n >= 0) attributed.push([n, box.elementId]);
              }
              let connectors = 0;
              sceneSteps.forEach((it, n) => {
                if (it.do === 'connect') {
                  const made = connectElements(it, boxes, idFor(beat.id, n), composition ? alongside(it, n) : connectors);
                  // A label may move anywhere around the pair it joins, and no
                  // further: see connectionRegion.
                  const drawn = [it.from, it.to].map((end) => {
                    const placed = boxes.get(end);
                    const figure = placed && figures.find((f) => f.id === placed.elementId);
                    return figure ? boxOf(figure) : undefined;
                  });
                  const labelId = labelIdFor(idFor(beat.id, n));
                  const at = made.findIndex((m) => m.id === labelId);
                  /**
                   * WORDS ON A PICTURE GO ABOVE THE ROW.
                   *
                   * A connector's label is born at the middle of its arrow, and
                   * an arrow between two things that are not neighbours runs
                   * straight through the one between them — so its words were
                   * written over that thing's icon and its name, and the solver,
                   * held to the region round the two ends, had nowhere free to
                   * take them (canvas audit 2026-10-01, item 4). Both overlaps
                   * that refused Class 10 Science that day had this shape — a
                   * place under a connector's label — and boards built to it
                   * reproduce their exact ids (class-prep tests/fixtures/
                   * class10Science.ts). Lifted to just above the tops of
                   * everything it spans, still centred over its own arrow —
                   * the place a teacher writes it.
                   */
                  if (at >= 0 && drawn[0] && drawn[1]) {
                    const words = made[at] as Extract<Element, { kind: 'handwrite' }>;
                    const onAPicture = figureBoxes.some((f) => overlaps(padLabel(boxOf(words)), f));
                    const sameRow = drawn[0].y < drawn[1].y + drawn[1].h && drawn[1].y < drawn[0].y + drawn[0].h;
                    if (onAPicture && sameRow) {
                      const size = Math.min(words.size ?? 26, LANE_SIZE);
                      const half = handWidth(words.text, size) / 2;
                      const rowFrom = Math.min(drawn[0].y, drawn[1].y);
                      const rowTo = Math.max(drawn[0].y + drawn[0].h, drawn[1].y + drawn[1].h);
                      const under = figureBoxes.filter(
                        (f) => f.x < words.x + half && words.x - half < f.x + f.w && f.y < rowTo && rowFrom < f.y + f.h,
                      );
                      const rowTop = Math.min(...under.map((f) => f.y), rowFrom);
                      const lifted = { ...words, size, y: rowTop - LANE_CLEAR - size * 0.35 } as Element;
                      // Inside the scene's own rectangle (a lane drawn lower
                      // still starts at r.y), and clear of every picture.
                      const fits =
                        boxOf(lifted).y - LANE_CLEAR >= r.y &&
                        !figureBoxes.some((f) => overlaps(padLabel(boxOf(lifted)), f));
                      if (fits) made[at] = lifted;
                      else stuck = true;
                    }
                  }
                  if (drawn[0] && drawn[1]) {
                    // The label's own starting point belongs to the region too.
                    // Siblings are nudged clear of one another perpendicular to
                    // their lines, which can start a label just outside the pair
                    // it joins — and a leash that excluded where the label was
                    // BORN was a rule broken before the solver ever ran.
                    const home = made.find((m) => m.id === labelId);
                    const region = home
                      ? union(connectionRegion(drawn[0], drawn[1]), boxOf(home))
                      : connectionRegion(drawn[0], drawn[1]);
                    tied.push({ id: labelId, region });
                  }
                  connectors += 1;
                  out.push(...made);
                  for (const m of made) attributed.push([n, m.id]);
                } else if (it.do === 'annotate') {
                  const made = annotateElement(it, boxes, idFor(beat.id, n));
                  // A mark is MEANT to sit on what it marks; the solver must not
                  // push the circle off the thing it is circling.
                  const target = boxes.get(it.target);
                  if (target) for (const m of made) meant.push({ a: m.id, b: target.elementId });
                  out.push(...made);
                  for (const m of made) attributed.push([n, m.id]);
                }
              });
              return { out, attributed, tied, meant, stuck };
            };

            /**
             * A label that needed the room above its row and found none — the
             * row filled its band to the top — gets that room: the scene is
             * drawn again a lane lower. Only then, so a scene whose words
             * already sat clear is drawn exactly as it always was.
             */
            const first = drawScene(r);
            const drawnScene = first.stuck ? drawScene({ ...r, y: r.y + LANE, h: r.h - LANE }) : first;
            for (const [n, id] of drawnScene.attributed) byInstruction.set(n, [...(byInstruction.get(n) ?? []), id]);
            leashes.push(...drawnScene.tied);
            bonds.push(...drawnScene.meant);
            return drawnScene.out;
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
        pointAt.push({ at: index, ref: `${item.ref}#${item.part}` });
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
        // A toolkit tool is drawn like a figure: its own shape, never under
        // its floor. Bad params are still placed — validateLesson names them
        // to the repair round, which an instruction dropped here never would.
        if (isToolName(item.do)) {
          const tool = item.do;
          const params = toolParamsOf(item as ToolInstruction);
          blocks.push({
            kind: tool,
            at: index,
            height: null,
            place: (r) => {
              const aspect = toolAspect(tool, params);
              const min = toolMinSize(tool);
              const w = Math.max(Math.min(r.w, r.h * aspect), min.w, min.h * aspect);
              return [{ kind: 'tool', id: idFor(beat.id, index), x: r.x + (r.w - w) / 2, y: r.y, w, h: w / aspect, tool, params }];
            },
          });
        }
        // An instruction this engine does not know is SKIPPED, never spun on.
        // The switch used to have no default, and an unknown `do` left `i`
        // untouched — the loop hung for two minutes until a test timed out.
        i += 1;
        break;
      }
    }
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
  /** Pages the column beside a figure needed, when it turned one. */
  let columnSheets = 1;
  /**
   * The page the stacker starts on. Not 0 when a labelled figure has already
   * filled the first page(s) by hand and left blocks for the stacker to place.
   */
  let firstSheet = 0;
  /** Set once a branch below has placed the beat's figure itself. */
  let figurePlaced = false;

  const FIGURE: ReadonlySet<Block['kind']> = new Set(['picture', 'diagram', 'chart', 'plot', 'flow']);
  const figures = blocks.filter((b) => FIGURE.has(b.kind) || isToolName(b.kind));
  /**
   * THE FIGURE THE NAMES ARE WRITTEN ROUND.
   *
   * The only one, when there is one. With two figures in a beat — a picture
   * and a flow — this used to be nobody, and every name was dropped (canvas
   * audit 2026-10-01, item 6). Now it is the figure the first name (or the
   * sketch) points into, and the other figure goes on the next page with
   * everything else the labelled arrangement does not place itself.
   */
  const namedRef = pendingLabels[0]?.step.target ?? pendingSketch?.step.from;
  const labelledHost =
    pendingLabels.length > 0 || pendingSketch !== null
      ? figures.length === 1
        ? figures[0]
        : figures.find((f) => namedRef !== undefined && f.ref === splitPartRef(namedRef).elementId)
      : undefined;
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
  /** How far down each region of a composed page's first sheet is already used (compose.ts, fillRegions). */
  const reserved = new Map<string, number>();
  /**
   * A COMPOSED FIGURE: the labelled arrangement below draws the figure and its
   * names inside the page's hero region, and leaves every key point and list
   * to the regions beside and under it. On a stacked page its room is the band
   * it always had, so nothing there moves.
   */
  const composedFigure = composition !== null && composition.name === 'figure' && labelledHost !== undefined;
  const area: Rect =
    composedFigure && composition?.main ? composition.main : { x: SIDE, y: MAIN.y, w: WIDTH, h: MAIN.h };
  /** On a composed page: the part each name, line and mark belongs to, and the names in drawing order (ink.ts). */
  const partOf = new Map<string, string>();
  const namedParts: { part: string; text: string }[] = [];

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
  if (labelledHost && (composition === null || composedFigure)) {
    if (composedFigure) regionNow = '0/hero';
    const MARGIN_GAP = 18;

    /**
     * A NAME WHOSE PART WAS LOOKED FOR AND NOT FOUND IS WRITTEN IN A KEY UNDER
     * THE PICTURE (small intestine, 2026-10-06).
     *
     * In the margin with no line it floats beside the picture pointing at
     * nothing, which every name on that class's villus did. So once the
     * picture has been looked at — `parts` knows it, found or not — a name it
     * has no part for is written in a row under the picture, inside the hero,
     * a bullet before it, at the line that names it. (Down the notes column it
     * pushed the list of the parts onto the next page.) When every name is in
     * the key, the margins are the picture's. Before anyone has looked — the
     * draft, laid out while the picture is still being made — names wait in
     * the margin as they always have: the part may yet be found. Composed
     * pages only.
     */
    const lookedAt =
      composedFigure && labelledHost.kind === 'picture' && labelledHost.ref !== undefined
        ? parts.get(labelledHost.ref)
        : undefined;
    const keyed = new Set(
      lookedAt
        ? pendingLabels.filter((p) => {
            const { elementId, part } = splitPartRef(p.step.target);
            return elementId === labelledHost.ref && part !== null && !lookedAt.some((q) => q.name === part);
          })
        : [],
    );
    const keyNames = pendingLabels.filter((p) => keyed.has(p));
    const keyRows = keyRowsOf(keyNames.map((p) => p.step.text), area.w);
    const keyLead = handLead(HOMELESS_NAME_SIZE);
    const keyH = keyRows.length > 0 ? keyRows.length * keyLead + KEY_GAP : 0;
    const everyNameKeyed = keyNames.length > 0 && keyNames.length === pendingLabels.length && !pendingSketch;

    // A composed hero is 590 wide, not the board's 860: a 26% margin either
    // side left a wide picture 266 units across, under half its region. 18%
    // still holds a name at the sizes below, and the picture takes the rest.
    const leastMargin = everyNameKeyed ? 0 : Math.round((area.w - MARGIN_GAP * 2) * (composedFigure ? 0.18 : 0.26));
    const columnW = area.w - MARGIN_GAP * 2 - leastMargin * 2;
    const columnX = area.x + leastMargin + MARGIN_GAP;

    // What she says out loud gets written under what she is saying it about.
    // The band is measured first, because the picture's height is whatever is
    // left once the points have the room they need.
    const bandRoom = MAIN.h + SPARE_BELOW;
    // Lists are written under the figure too, and they are measured before the
    // key points because they are the taller thing: a four-item list is most of
    // a band on its own, and the figure has to know that before it takes a size.
    const listsH = composedFigure ? 0 : written.reduce((sum, b) => sum + (b.height ?? 0) + BAND_GAP, 0);
    // Wrapped to the room the band actually has: it starts at the figure's
    // edge, not the board's, so a line wrapped to the full width would walk
    // off the right side.
    const bandWidth = area.w - leastMargin - MARGIN_GAP;
    const band = planBand(
      composedFigure ? [] : pendingWrites.map((point) => point.step.text),
      bandWidth,
      Math.max(0, bandRoom - MIN_FIGURE_H - BAND_GAP - listsH),
    );
    const under = band.height + listsH;
    const figureH = composedFigure
      ? area.h - keyH
      : under > 0
        ? Math.max(MIN_FIGURE_H, bandRoom - under - BAND_GAP)
        : MAIN.h;

    current = labelledHost.at ?? -1;
    for (const el of labelledHost.place({ x: columnX, y: area.y, w: columnW, h: figureH })) {
      emit(el);
    }

    const host = elements.find((el) => el.id === labelledHost.ref);
    const hostBox = host ? boxOf(host) : null;

    // The key: each row centred under the picture, each name at its own line.
    keyRows.forEach((row, r) => {
      const y = area.y + figureH + KEY_GAP + HOMELESS_NAME_SIZE * 0.9 + r * keyLead;
      let x = area.x + (area.w - row.w) / 2;
      for (const { index, w } of row.items) {
        const pending = keyNames[index];
        current = pending.at;
        emit({ kind: 'text', id: `${pending.id}_dot`, x: x + 8, y, text: '•', size: HOMELESS_NAME_SIZE });
        emit({
          kind: 'handwrite',
          id: pending.id,
          x: x + KEY_DOT_W + w / 2,
          y,
          text: pending.step.text,
          size: HOMELESS_NAME_SIZE,
          ...(pending.step.tone ? { tone: pending.step.tone } : {}),
        });
        leashes.push({ id: pending.id, region: { x: x + KEY_DOT_W + w / 2 - 14, y: y - 12, w: 28, h: 24 } });
        x += KEY_DOT_W + w + KEY_ITEM_GAP;
      }
    });

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
        side === 'left' ? near - MARGIN_GAP - area.x : area.x + area.w - (near + MARGIN_GAP),
      );
      return { w, cx: side === 'left' ? area.x + w / 2 : area.x + area.w - w / 2 };
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
    // The names written beside the picture: every one but those in its key.
    const placedFor = pendingLabels
      .filter((pending) => !keyed.has(pending))
      .map((pending) => {
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
     * How tall a side's names stand, written at one size: each name's lines
     * plus the space under it. The same sum decides the size and the spill.
     */
    const pileOf = (side: 'left' | 'right', size: number): number => {
      const lead = handLead(size);
      return placedFor
        .filter(({ pending }) => sideOf.get(pending) === side)
        .reduce((sum, { pending }) => sum + wrapText(pending.step.text, margins[side].w, size).length * lead + 12, 0);
    };

    /**
     * A SIDE THAT CANNOT HOLD ITS NAMES GIVES SOME TO THE OTHER SIDE.
     *
     * Once the parts are known every name goes to the side its part is on, and
     * a picture whose parts all sit on its left sends every name left. Even at
     * the smallest size that is sometimes more than the figure is tall, and the
     * names past the foot of the figure were clamped back onto the ones above
     * them. So the name whose part is nearest the middle — the one whose line is
     * least hurt by crossing — moves across, one at a time, while the other
     * side has room for it. A beat with a sketch keeps every name on the left:
     * the right is the sketch's.
     */
    if (!pendingSketch && hostBox) {
      const middle = hostBox.x + hostBox.w / 2;
      for (const side of ['left', 'right'] as const) {
        const other = side === 'left' ? 'right' : 'left';
        while (pileOf(side, 14) > figureH) {
          const movable = placedFor
            .filter(({ pending, box }) => box !== null && sideOf.get(pending) === side)
            .sort((a, b) => Math.abs(a.box!.x + a.box!.w / 2 - middle) - Math.abs(b.box!.x + b.box!.w / 2 - middle));
          const mover = movable[0];
          if (!mover) break;
          sideOf.set(mover.pending, other);
          if (pileOf(other, 14) > figureH) {
            sideOf.set(mover.pending, side);
            break;
          }
        }
      }
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
      for (const size of [20, 18, 16, 14]) {
        if (pileOf(side, size) <= figureH) return size;
      }
      return 14;
    };
    const sizes = { left: sizeFor('left'), right: sizeFor('right') };

    /**
     * WHERE EACH NAME STANDS, worked out a side at a time before any is
     * written.
     *
     * Beside its own part, and in the ORDER the parts run down the picture —
     * not the order the names were said in. Stacked in spoken order, each name
     * below the last and then clamped to the foot of the figure, a side whose
     * first name pointed low put every later name on the same spot: five names
     * at one height, which is what the keep gate refused (canvas audit
     * 2026-10-01, item 3). Sorted, a name only moves down to clear the one above
     * it, and a side that runs past the foot is pushed back UP as one column, so
     * nothing is clamped onto anything. A name whose part is unknown wants the
     * top, as before — so the draft, laid out before any picture exists, comes
     * out exactly as it did whenever its names fit beside the figure.
     */
    const NAME_GAP = 10;
    const standing = new Map<Pending, number>();
    for (const side of ['left', 'right'] as const) {
      const lead = handLead(sizes[side]);
      const column = placedFor
        .filter(({ pending }) => sideOf.get(pending) === side)
        .map(({ pending, box }) => {
          const height = wrapText(pending.step.text, margins[side].w, sizes[side]).length * lead;
          return { pending, height, wanted: box ? box.y + box.h / 2 - height / 2 : area.y, top: 0 };
        })
        .sort((a, b) => a.wanted - b.wanted);
      let cursor = area.y;
      for (const name of column) {
        name.top = Math.max(name.wanted, cursor);
        cursor = name.top + name.height + NAME_GAP;
      }
      let ceiling = area.y + figureH;
      for (let k = column.length - 1; k >= 0; k -= 1) {
        column[k].top = Math.min(column[k].top, ceiling - column[k].height);
        ceiling = column[k].top - NAME_GAP;
      }
      // Taller than the figure even so: written down from the top, past the
      // foot, rather than over one another.
      if (column.length > 0 && column[0].top < area.y) {
        cursor = area.y;
        for (const name of column) {
          name.top = cursor;
          cursor += name.height + NAME_GAP;
        }
      }
      for (const name of column) standing.set(name.pending, name.top);
    }

    for (const { pending, box } of placedFor) {
      const side = sideOf.get(pending)!;
      const onLeft = side === 'left';
      const size = sizes[side];
      const lines = wrapText(pending.step.text, margins[side].w, size);
      const lead = handLead(size);
      // Its colour on a composed page: the part it names, when the picture has it.
      const named = composition && box ? splitPartRef(pending.step.target).part : null;
      if (named) {
        namedParts.push({ part: named, text: pending.step.text });
        lines.forEach((_, n) => partOf.set(n === 0 ? pending.id : `${pending.id}_l${n}`, named));
        partOf.set(`${pending.id}_line`, named);
      }
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
      const widest = Math.max(...lines.map((line) => handWidth(line, size)));
      const edge = hostBox
        ? onLeft
          ? hostBox.x - MARGIN_GAP
          : hostBox.x + hostBox.w + MARGIN_GAP
        : onLeft
          ? area.x + margins.left.w
          : area.x + area.w - margins.right.w;
      const cx = onLeft
        ? Math.max(area.x + widest / 2, edge - widest / 2)
        : Math.min(area.x + area.w - widest / 2, edge + widest / 2);

      // Where the side's column put it (above), as the first line's baseline.
      const top = standing.get(pending)! + size;

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
      // On a composed page the inset heads the notes column, and the notes
      // start under it. On a stacked page it sits beside the picture, level
      // with its part, as before.
      const column = composedFigure ? composition!.regions.find((r) => r.id === 'side') : undefined;
      const x = column ? column.x : hostBox.x + hostBox.w + MARGIN_GAP;
      const w = column ? column.w : Math.max(150, SIDE + WIDTH - x);
      // 0.55 of the column's width tall: a three-item notes list still fits under it.
      const h = column ? Math.round(column.w * 0.55) : Math.max(120, Math.min(figureH, Math.round(w * 0.8)));
      const part = partBox(pendingSketch.step.from, elements);
      const wanted = part ? part.y + part.h / 2 - h / 2 : MAIN.y;
      const y = column ? column.y : Math.min(Math.max(wanted, MAIN.y), MAIN.y + figureH - h);
      if (column) {
        regionNow = '0/side';
        reserved.set(column.id, h + FILL_GAP);
      }
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
      if (part && column) {
        // The textbook zoom: a box round the part, and dashed lines from its
        // corners to the inset. In the inset's region, so the camera frames
        // the part and the inset together when it arrives.
        const zoomId = `${pendingSketch.id}_zoom`;
        emit({ kind: 'mark', id: zoomId, x: part.x - 6, y: part.y - 6, w: part.w + 12, h: part.h + 12, shape: 'box', tone: 'accent' });
        bonds.push({ a: zoomId, b: labelledHost.ref ?? '' });
        const corners: [number, number][] = [
          [part.y - 6, y],
          [part.y + part.h + 6, y + h],
        ];
        corners.forEach(([fromY, toY], k) => {
          const lineId = `${pendingSketch!.id}_zoom${k}`;
          emit({
            kind: 'arrow',
            id: lineId,
            from: { x: part.x + part.w + 6, y: fromY },
            to: { x: x - 4, y: toY },
            dashed: true,
            tone: 'accent',
          });
          bonds.push({ a: lineId, b: ref }, { a: lineId, b: labelledHost.ref ?? '' }, { a: lineId, b: zoomId });
        });
        regionNow = '0/hero';
      } else if (part) {
        const arrowId = `${pendingSketch.id}_arrow`;
        emit({
          kind: 'arrow',
          id: arrowId,
          from: { x: part.x + part.w * 0.6, y: part.y + part.h / 2 },
          to: { x: x - 4, y: y + h / 2 },
          tone: 'accent',
        });
        bonds.push({ a: arrowId, b: ref });
        bonds.push({ a: arrowId, b: labelledHost.ref ?? '' });
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

    const placePoint = (n: number): void => {
      const point = pendingWrites[n];
      current = point.at;
      const lines = band.lines[n];
      roomFor(lines.length * bandLead);
      const px = (sheet === 0 ? bandLeft : SIDE) + sheet * PAGE_STRIDE;
      lines.forEach((line, k) => {
        const id = k === 0 ? point.id : `${point.id}_l${k}`;
        const x = px + handWidth(line, band.size) / 2;
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
    };

    /**
     * And the lists, with the key points.
     *
     * Placed here rather than left to the stacker, because this branch ends by
     * emptying the block list — and anything it had not placed itself simply
     * vanished. A list written into a beat with a labelled picture appeared
     * nowhere at all: no error, no gap, just a board missing the half the
     * student was meant to copy down.
     */
    const placeList = (block: Block): void => {
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
    };

    /**
     * In the order she says them, a spoken line at a time.
     *
     * The points used to be written first and the lists after, so a line that
     * made a point and wrote a list put the point under the picture and the
     * list on the next page — one line on two pages, and the camera on one of
     * them (canvas audit 2026-10-01). Now everything one line writes is
     * measured together, and the page turns BEFORE a line that does not fit;
     * each piece still turns it on its own only when one line is taller than
     * a page.
     */
    type BandItem = { at: number; point?: number; list?: Block };
    /**
     * A LINE THAT ALSO WRITES WHAT THE BAND CANNOT HOLD GOES WHOLE TO THE NEXT
     * PAGE (2026-10-02). A card, a note, an equation goes to the page after
     * the picture; a key point or a list said in the same line used to stay in
     * the band — one line on two pages, the camera on the newer one, and the
     * list in the Respiration class prepared that night never on screen. So
     * that line's points and lists leave the band with it.
     */
    const offBandLines = new Set(
      blocks
        .filter((b) => b !== labelledHost && b.kind !== 'write' && b.kind !== 'list' && b.at !== null)
        .map((b) => lineOf[b.at as number]),
    );
    const leavesBand = (at: number): boolean => offBandLines.has(lineOf[at]);
    const bandItems: BandItem[] = composedFigure
      ? []
      : [
          ...pendingWrites.map((p, n): BandItem => ({ at: p.at, point: n })),
          ...written.map((block): BandItem => ({ at: block.at ?? -1, list: block })),
        ]
          .filter((item) => !leavesBand(item.at))
          .sort((a, b) => a.at - b.at);
    const tallness = (item: BandItem): number =>
      item.point !== undefined
        ? band.lines[item.point].length * bandLead + POINT_GAP
        : (item.list?.height ?? 0) + BAND_GAP;
    for (let i = 0; i < bandItems.length; ) {
      let end = i + 1;
      while (end < bandItems.length && lineOf[bandItems[end].at] === lineOf[bandItems[i].at]) end += 1;
      const said = bandItems.slice(i, end);
      roomFor(said.reduce((sum, item) => sum + tallness(item), 0) - POINT_GAP);
      for (const item of said) {
        if (item.point !== undefined) placePoint(item.point);
        else if (item.list) placeList(item.list);
      }
      i = end;
    }
    bandSheets = sheet + 1;

    /**
     * WHAT THE ARRANGEMENT ABOVE DID NOT PLACE GOES ON THE NEXT PAGE.
     *
     * The figure, its names, its key points and its lists were all placed by
     * hand above. Everything else — a note, a card,
     * an equation, a scene, a second figure — used to be thrown away with the
     * rest of the block list: a definition banner the prompt asks for beside
     * every demonstration simply never appeared (canvas audit 2026-10-01, item
     * 6). It now goes to the stacker, which starts on the page after this
     * figure's last one, so nothing is drawn over the picture or its band.
     */
    const leftover = composedFigure
      ? blocks.filter((b) => b !== labelledHost)
      : blocks.filter(
          (b) =>
            b !== labelledHost &&
            ((b.kind !== 'write' && b.kind !== 'list') || (b.at !== null && leavesBand(b.at))),
        );
    blocks.length = 0;
    blocks.push(...leftover);
    firstSheet = bandSheets;
    figurePlaced = true;
    regionNow = null;
  }

  if (
    composition === null &&
    !figurePlaced &&
    figures.length === 1 &&
    figures[0].narrow !== false &&
    beside.length > 0 &&
    blocks.length === 1 + beside.length
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
    /**
     * AND WHEN THE COLUMN RUNS OUT, THE PAGE TURNS.
     *
     * It used to write on down: four wrapped key points beside a diagram ended
     * at 658 on a board 620 high, through the caption on the way (canvas audit
     * 2026-10-01, item 6: 19.1% of random beats with a diagram and two to four
     * points ran off the board). It stops where the labelled figure's band stops, above the
     * caption, and carries on at the top of the next page across the full
     * width — a spoken line at a time, so the page turns before a line whose
     * ink would not all fit, never in the middle of one.
     */
    const columnBottom = MAIN.y + MAIN.h + SPARE_BELOW;
    let sheet = 0;
    let ry = MAIN.y;
    const columnAt = (): { x: number; w: number } =>
      sheet === 0 ? { x: SIDE + figureW + GAP, w: columnW } : { x: SIDE + sheet * PAGE_STRIDE, w: WIDTH };
    /** Where a run of blocks would end if written from `y` — placed, measured, thrown away. */
    const endOf = (run: readonly Block[], y: number): number => {
      let at = y;
      for (const block of run) {
        let bottom = at;
        for (const el of block.place({ ...columnAt(), y: at, h: WRITE_H })) {
          bottom = Math.max(bottom, boxOf(el).y + boxOf(el).h);
        }
        at = bottom + BETWEEN_POINTS;
      }
      return at - BETWEEN_POINTS;
    };
    const rest = blocks.filter((b) => b !== figures[0]);
    for (let k = 0; k < rest.length; ) {
      let end = k + 1;
      while (end < rest.length && lineOf[rest[end].at ?? -1] === lineOf[rest[k].at ?? -1]) end += 1;
      const said = rest.slice(k, end);
      if (ry > MAIN.y && endOf(said, ry) > columnBottom) {
        sheet += 1;
        ry = MAIN.y;
      }
      for (const block of said) {
        // One line taller than what is left of a page still turns it.
        if (ry > MAIN.y && endOf([block], ry) > columnBottom) {
          sheet += 1;
          ry = MAIN.y;
        }
        current = block.at ?? -1;
        let bottom = ry;
        for (const el of block.place({ ...columnAt(), y: ry, h: WRITE_H })) {
          emit(el);
          bottom = Math.max(bottom, boxOf(el).y + boxOf(el).h);
        }
        ry = bottom + BETWEEN_POINTS;
      }
      k = end;
    }
    columnSheets = sheet + 1;

    blocks.length = 0;
  }

  /**
   * --- a composed page: the main demonstration in its region, the writing in the others ---
   *
   * Everything here is placed by region (compose.ts, fillRegions), so the
   * stacker below is left nothing to stack.
   */
  let composedSheets = 0;
  if (composition) {
    // A comparison is this page's main demonstration only on a compare page;
    // anywhere else it is a section written beside the main one.
    const mainBlock = blocks.find((b) => isMainKind(b.kind) && (b.kind !== 'compare' || composition.name === 'compare'));
    if (composition.main && mainBlock) {
      current = mainBlock.at ?? -1;
      regionNow = `0/${composition.main.id}`;
      let bottom = composition.main.y;
      for (const el of mainBlock.place({ ...composition.main, h: mainBlock.height ?? composition.main.h })) {
        emit(el);
        const b = boxOf(el);
        bottom = Math.max(bottom, b.y + b.h);
      }
      reserved.set(composition.main.id, bottom - composition.main.y + FILL_GAP);
    }
    // A newPage at or before the main demonstration's line turns away from a
    // page that holds only its title and that demonstration: every beat
    // already starts on a page of its own, so it is not a turn at all.
    const mainAt = composedFigure ? labelledHost?.at : mainBlock?.at;
    const mainLine = mainAt === null || mainAt === undefined ? -1 : (lineOf[mainAt] ?? -1);
    const rest = blocks.filter(
      (b) => b !== mainBlock && !(b.kind === 'newPage' && b.at !== null && (lineOf[b.at] ?? -1) <= mainLine),
    );
    const fillables: Fillable[] = rest.map((b) => ({
      line: b.at === null ? -1 : (lineOf[b.at] ?? -1),
      // A comparison is read across its two columns, so it goes where the key
      // points go: the widest place writing takes (under a figure, beside a scene).
      role:
        b.kind === 'summary'
          ? 'summary'
          : b.kind === 'newPage'
            ? 'newPage'
            : b.kind === 'write' || b.kind === 'caption' || b.kind === 'compare'
              ? 'points'
              : 'notes',
      heightAt: b.heightAt ?? ((w: number) => measured(b, w)),
    }));
    const first = inTwoColumns(composition, fillables.map((f) => f.role));
    for (const p of fillRegions(fillables, first, reserved)) {
      const b = rest[p.index];
      current = b.at ?? -1;
      regionNow = `${p.sheet}/${p.region}`;
      for (const el of b.place({ ...p.rect, x: p.rect.x + p.sheet * PAGE_STRIDE })) emit(el);
      composedSheets = Math.max(composedSheets, p.sheet + 1);
    }
    regionNow = null;
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
  /**
   * AND THE PAGE TURNS BETWEEN SPOKEN LINES, NEVER DURING ONE.
   *
   * Packed a block at a time, a line that wrote three equations filled the
   * page on its second and drew its third on the next — while the camera,
   * which follows the newest ink, showed only the third (canvas audit
   * 2026-10-01: 16% of moments drew on two pages). So blocks are packed a LINE
   * at a time: a line whose ink does not fit what is left of the page starts
   * the next page whole. Only a line taller than a page is split, and the keep
   * gate's `one-page` rule tells the planner to split that line.
   */
  const spoken: Block[][] = [];
  let lastLine: number | null = null;
  for (const block of blocks) {
    // A block that recorded its own ids belongs with the one before it.
    const line: number | null = block.at === null ? lastLine : (lineOf[block.at] ?? lastLine);
    if (spoken.length === 0 || line !== lastLine) spoken.push([]);
    spoken[spoken.length - 1].push(block);
    lastLine = line;
  }
  const heightOf = (line: readonly Block[]): number =>
    line.reduce((sum, b, k) => sum + leastOf(b) + (k > 0 ? GUTTER : 0), 0);
  const sheets: Block[][] = [[]];
  let taken = 0;
  for (const spokenLine of spoken) {
    // A `newPage` turns the page at the start of the spoken line it falls in —
    // a line still draws on one page — if the page has anything on it, and
    // takes no room of its own.
    const turns = spokenLine.some((b) => b.kind === 'newPage');
    const line = spokenLine.filter((b) => b.kind !== 'newPage');
    if (
      sheets[sheets.length - 1].length > 0 &&
      (turns || taken + GUTTER + heightOf(line) > MAIN.h)
    ) {
      sheets.push([]);
      taken = 0;
    }
    for (const block of line) {
      const here = sheets[sheets.length - 1];
      const gutter = here.length > 0 ? GUTTER : 0;
      if (here.length > 0 && taken + gutter + leastOf(block) > MAIN.h) {
        sheets.push([block]);
        taken = leastOf(block);
        continue;
      }
      here.push(block);
      taken += gutter + leastOf(block);
    }
  }

  sheets.forEach((sheet, sheetIndex) => {
    if (sheet.length === 0) return;
    const dx = (firstSheet + sheetIndex) * PAGE_STRIDE;
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
  const stackedSheets = sheets.filter((s) => s.length > 0).length;
  const sheetsUsed = Math.max(
    1,
    stackedSheets > 0 ? firstSheet + stackedSheets : 0,
    bandSheets,
    columnSheets,
    composedSheets,
  );

  // --- mark the things the scene does not own ---
  //
  // A picture now knows its rectangle, so a circle round the cortex can be
  // worked out: the part's fractional box, scaled into the picture's box. This
  // is the move that lets ONE picture carry a whole stretch of teaching — she
  // marks it, writes beside it, and never needs another image.
  for (const pending of pendingMarks) {
    // A line she wrote: marked where its lines landed, all of it or a span.
    const written = writtenAt.get(pending.step.target);
    if (written !== undefined) {
      const ids = new Set(byInstruction.get(written) ?? []);
      const lines = elements.filter((el) => ids.has(el.id));
      const box = markedBox(lines, pending.step.span);
      if (!box) continue;
      const grow = pending.step.mark === 'underline' || pending.step.mark === 'highlight' ? 2 : 10;
      current = pending.at;
      regionNow = composition ? (regions[lines[0]?.id ?? ''] ?? null) : null;
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
      for (const line of lines) bonds.push({ a: pending.id, b: line.id });
      continue;
    }

    // An item of a list she wrote: `<list id>#<n>`, its row highlighted.
    const item = /^(.+)#(\d+)$/.exec(pending.step.target);
    const listIndex = item ? listAt.get(item[1]) : undefined;
    if (item && listIndex !== undefined) {
      const list = elements.find(
        (el): el is Extract<Element, { kind: 'list' }> =>
          el.kind === 'list' && (byInstruction.get(listIndex) ?? []).includes(el.id),
      );
      const row = list ? listItemBox(list, Number(item[2])) : null;
      if (!list || !row) continue;
      current = pending.at;
      regionNow = composition ? (regions[list.id] ?? null) : null;
      emit({
        kind: 'mark',
        id: pending.id,
        x: row.x - 2,
        y: row.y - 2,
        w: row.w + 4,
        h: row.h + 4,
        shape: pending.step.mark,
        ...(pending.step.tone ? { tone: pending.step.tone } : {}),
      });
      bonds.push({ a: pending.id, b: list.id });
      continue;
    }

    const box = partBox(pending.step.target, elements);
    if (!box) continue;
    const { elementId } = splitPartRef(pending.step.target);
    if (composition) {
      const marked = splitPartRef(pending.step.target).part;
      if (marked) partOf.set(pending.id, marked);
    }
    const host = elements.find((el) => el.id === elementId);
    if (!host) continue;

    const grow = pending.step.mark === 'underline' ? 0 : 10;
    current = pending.at;
    regionNow = composition ? (regions[host.id] ?? null) : null;
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
  regionNow = null;
  // One colour per named part, on its name, its line, its marks and its notes item (ink.ts).
  if (composition && namedParts.length > 0) {
    elements.splice(0, elements.length, ...paintInks(elements, inksFor(namedParts), partOf));
  }

  // INK TIMED TO A WORD (canvas C3). A write, an equation or a toolkit tool with `at` waits
  // until she reaches that word of the line it is written under — every line
  // it drew, in whichever arrangement placed it. A word her line does not
  // hold leaves the ink where it was, with the start of the line.
  items.forEach((item, index) => {
    const timed = item.do === 'write' || item.do === 'equation' || isToolName(item.do);
    const at = timed && 'at' in item && typeof item.at === 'string' ? item.at : '';
    if (!at) return;
    const said = saidLines[lineOf[index] - 1] ?? '';
    const wait = anchorMs(said, at);
    if (wait <= 0) return;
    const ids = new Set(byInstruction.get(index) ?? []);
    elements.forEach((el, k) => {
      if (!ids.has(el.id) || (el.kind !== 'handwrite' && el.kind !== 'formula' && el.kind !== 'tool')) return;
      elements[k] = { ...el, after: (el.after ?? 0) + wait };
    });
  });

  // Nothing on the board sits on anything else.
  //
  // The stacking rules already keep blocks apart; this catches the things drawn
  // BETWEEN and OVER them — a connector's label, a mark — which follow whatever
  // they refer to and so can land anywhere. Fixing those case by case fixes one
  // lesson at a time; this fixes every lesson.
  const settled = resolveOverlaps(
    elements,
    bonds,
    composition
      ? [
          // A composed page's writing lives under its header. A label the
          // solver must move may use any of that, and never the header.
          { x: 8, y: PAGE.top - 6, w: CANVAS_W - 16, h: PAGE.bottom - PAGE.top + 12 },
          { x: 8, y: 8, w: CANVAS_W - 16, h: CANVAS_H - 16 },
        ]
      : [
          // A label's first room is MAIN, where its scene lives. The whole canvas
          // was once its playground, and a stuck label got parked above the lesson
          // title — clear space, wrong room.
          { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: MAIN.h + 20 },
          // When MAIN is genuinely full, everything below the title is fair — a
          // label near the caption reads as a footnote; one over the heading reads
          // as a mistake.
          { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: CANVAS_H - MAIN.y },
        ],
    leashes,
    { parkFirst: composition !== null },
  );

  // A part can only be pointed at if its picture is on the board this beat.
  const shown = new Set(show);
  const keptFocus = focus.filter((f) => shown.has(f.split('#')[0]));

  /**
   * FROM ITEMS BACK TO BOARD INSTRUCTIONS, before reveal reads anything.
   *
   * Reveal walks `beat.board` and asks what each board instruction drew. An
   * ask is a board instruction with NO item, so keyed by item every
   * instruction after it would answer for its neighbour, and a key point
   * would come one line late or not at all.
   */
  const byBoard = new Map<number, string[]>();
  for (const [item, ids] of byInstruction) {
    const n = origin[item] ?? item;
    byBoard.set(n, [...(byBoard.get(n) ?? []), ...ids]);
  }

  const undrawn = beat.board.flatMap((step, index) =>
    WRITES_WORDS.has(step.do) && (byBoard.get(index) ?? []).length === 0
      ? [{ index, do: step.do, text: wordsOf(step) }]
      : [],
  );

  /** What each composed page holds, for the keep gate's page-full rule (class-prep). */
  const sheetReports: SheetReport[] = [];
  if (composition) {
    const itemOf = new Map<string, number>();
    for (const [item, ids] of byInstruction) for (const id of ids) itemOf.set(id, item);
    const kindOf = (id: string): string => {
      const item = itemOf.get(id);
      return item === undefined ? '' : items[item].do;
    };
    for (let s = 0; s < sheetsUsed; s += 1) {
      const here = settled.filter((el) => regions[el.id]?.startsWith(`${s}/`));
      const kinds = new Set(here.map((el) => kindOf(el.id)));
      // Each region counted from its first writing to its last (compose.ts,
      // writtenArea), in the page's own coordinates. Pages after the first
      // are notes pages; the header is the strip above PAGE.top.
      const sheetPage = s === 0 ? composition : ARRANGEMENTS.notes;
      const rectOf = (id: string): Rect =>
        id === 'header'
          ? { x: 0, y: 0, w: CANVAS_W, h: PAGE.top }
          : id === sheetPage.summary.id
            ? sheetPage.summary
            : sheetPage.main?.id === id
              ? sheetPage.main
              : (sheetPage.regions.find((r) => r.id === id) ?? { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
      const byRegion = new Map<string, Rect[]>();
      for (const el of here) {
        const id = regions[el.id].split('/')[1];
        const ink = boxOf(el);
        const local = { ...ink, x: ink.x - s * PAGE_STRIDE };
        // A key point is a row of the notes a student copies, and is counted
        // across its column the way a list's rows are: a list is as wide as its
        // column whatever its words, and a bullet point was counted only as
        // wide as its words, so a page that wrote its key points in a column of
        // their own read emptier than one that wrote them under its list.
        const region = rectOf(id);
        const row = kindOf(el.id) === 'write' && id !== 'header' ? { ...local, w: region.x + region.w - local.x } : local;
        byRegion.set(id, [...(byRegion.get(id) ?? []), row]);
      }
      const written = writtenArea([...byRegion].map(([id, boxes]) => ({ region: rectOf(id), boxes })));
      sheetReports.push({
        sheet: s,
        arrangement: sheetPage.name,
        empty: sheetPage.regions.filter((r) => !byRegion.has(r.id)).map((r) => r.id),
        coverage: coverage(written, 0),
        main: here.some(
          (el) => regions[el.id] === `${s}/hero` || (regions[el.id] === `${s}/main` && isMainKind(kindOf(el.id))),
        ),
        notes: ['list', 'note', 'card', 'compare', 'label'].some((k) => kinds.has(k)),
        list: ['list', 'note', 'card'].some((k) => kinds.has(k)),
        points: new Set(here.filter((el) => kindOf(el.id) === 'write').map((el) => itemOf.get(el.id))).size,
        summary: kinds.has('summary'),
      });
    }
  }

  return {
    elements: settled,
    laid: { show, focus: keptFocus },
    steps: revealSteps(
      beat,
      byBoard,
      keptFocus,
      composition
        ? new Map(
            pointAt
              .filter((p) => keptFocus.includes(p.ref))
              .map((p) => [origin[p.at] ?? p.at, p.ref] as [number, string]),
          )
        : undefined,
    ),
    bonds,
    leashes,
    pages: sheetsUsed,
    asks,
    undrawn,
    regions,
    sheets: sheetReports,
  };
}

/**
 * A block's height when drawn `w` wide: drawn into a throwaway rectangle and
 * measured, the way the column beside a figure measures its points. Only for
 * blocks whose `place` records nothing; the others say their own height
 * (Block.heightAt).
 */
function measured(block: Block, w: number): number {
  const drawn = block.place({ x: 0, y: 0, w, h: block.height ?? WRITE_H });
  if (drawn.length === 0) return 0;
  const boxes = drawn.map(boxOf);
  return Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(0, ...boxes.map((b) => b.y));
}

/** The instructions whose ink is words of their own, with no picture behind them. */
const WRITES_WORDS: ReadonlySet<Instruction['do']> = new Set([
  'title',
  'write',
  'note',
  'caption',
  'card',
  'equation',
  'list',
  'flow',
  'chart',
  'plot',
  'derive',
  'summary',
  'compare',
]);

/** A few of an instruction's own words, for a message that names it. */
function wordsOf(step: Instruction): string {
  switch (step.do) {
    case 'title':
    case 'write':
    case 'note':
    case 'caption':
    case 'equation':
    case 'summary':
      return step.text;
    case 'card':
      return step.heading;
    case 'compare':
      return typeof step.left?.heading === 'string' ? step.left.heading : '';
    case 'list':
      return step.heading ?? step.items[0]?.term ?? '';
    case 'flow':
      return step.steps[0]?.label ?? '';
    case 'chart':
      return step.caption ?? step.data[0]?.label ?? '';
    case 'plot':
      return step.caption ?? step.fn;
    case 'derive':
      return step.steps[0] ?? '';
    default:
      return isToolName(step.do) ? step.do : '';
  }
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
  /**
   * A composed board's points, by board instruction: each is lit on the line
   * it comes under, rather than all of them together on the beat's last line
   * (human heart, 2026-10-07: five parts of a diagram lit at once at the end,
   * none while it was explained). Absent on a stacked board, which keeps the
   * beat's emphasis on its last spoken moment.
   */
  lit?: ReadonlyMap<number, string>,
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
  /** What the line being spoken lights (composed board only). */
  let litNow: string[] = [];
  const flush = (): void => {
    if (narration === null) return;
    steps.push({ narration, show: [...cumulative], focus: [...litNow] });
    litNow = [];
  };

  beat.board.forEach((item, n) => {
    const lights = lit?.get(n);
    if (lights !== undefined && heldAt === null && !litNow.includes(lights)) litNow.push(lights);
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
    if (!lit) steps[last].focus = [...focus];
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
