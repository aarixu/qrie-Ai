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
  type Element,
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

/** Heights the renderer needs to agree with; see the notes on each. */
const EQUATION_H = 52;
const WRITE_H = 62;
const CARD_H = 128;
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
function wrapText(text: string, w: number, size: number): string[] {
  // Measured with the ruler everything else uses. Half an em per character
  // was a guess, and a generous one: it packed more onto a line than would
  // fit, so lines ran past the very margin they were being wrapped for.
  const usable = w * 0.94;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > usable) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
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
} {
  const elements: Element[] = [];
  const show: string[] = [];
  const focus: string[] = [];
  const blocks: Block[] = [];

  /** Which element ids each instruction produced, so reveal can follow the words. */
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

  const items = beat.board;

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
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
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
          place: (r) => [
            {
              kind: 'formula',
              id: idFor(beat.id, index),
              x: CANVAS_W / 2,
              y: r.y + EQUATION_H * 0.66,
              text: item.text,
            },
          ],
        });
        i += 1;
        break;
      }

      case 'write': {
        blocks.push({
          kind: item.do,
          at: index,
          height: WRITE_H,
          // Written on the centreline when it has the board, and inside its
          // own column when it is sharing with a picture. In a column it
          // WRAPS rather than shrinking: a key point squeezed to fit one line
          // of a narrow column came out too small to read from a desk, which
          // is the one thing a key point may not be.
          place: (r) => {
            const narrow = r.w < WIDTH * 0.75;
            const size = narrow ? 27 : 36;
            const lines = narrow ? wrapText(item.text, r.w, size) : [item.text];
            // Wider than the overlap solver breathes (6 units a side): set
            // tighter, consecutive lines read as a collision and the solver
            // shrinks the point until it fits — down to unreadable.
            const lead = size * 1.62;
            const top = r.y + size * 0.9;
            // Each line waits for the one above it — a person writes a second
            // line after the first, not alongside it.
            const perLine = 620;
            return lines.map((line, n) => ({
              kind: 'handwrite',
              ...(n > 0 ? { after: n * perLine } : {}),
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
                x: CANVAS_W / 2 - w / 2,
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
  const FIGURE: ReadonlySet<Instruction['do']> = new Set(['picture', 'diagram', 'chart', 'flow']);
  const figures = blocks.filter((b) => FIGURE.has(b.kind));
  const writes = blocks.filter((b) => b.kind === 'write');

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
  if (figures.length === 1 && pendingLabels.length > 0) {
    const MARGIN_GAP = 18;
    const marginW = Math.round((WIDTH - MARGIN_GAP * 2) * 0.26);
    const pictureW = WIDTH - MARGIN_GAP * 2 - marginW * 2;
    const pictureX = SIDE + marginW + MARGIN_GAP;

    current = figures[0].at ?? -1;
    for (const el of figures[0].place({ x: pictureX, y: MAIN.y, w: pictureW, h: MAIN.h })) {
      emit(el);
    }

    const host = elements.find((el) => el.id === figures[0].ref);
    const hostBox = host ? boxOf(host) : null;

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
      if (box && hostBox) {
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
        const lead = size * 1.5;
        const total = mine.reduce(
          (sum, { pending }) =>
            sum + wrapText(pending.step.text, marginW, size).length * lead + 12,
          0,
        );
        if (total <= MAIN.h) return size;
      }
      return 14;
    };
    const sizes = { left: sizeFor('left'), right: sizeFor('right') };

    const lowest = { left: MAIN.y, right: MAIN.y };
    for (const { pending, box } of placedFor) {
      const side = sideOf.get(pending)!;
      const onLeft = side === 'left';
      const size = sizes[side];
      const lines = wrapText(pending.step.text, marginW, size);
      const lead = size * 1.5;
      const height = lines.length * lead;
      const cx = onLeft
        ? SIDE + marginW / 2
        : SIDE + marginW + MARGIN_GAP + pictureW + MARGIN_GAP + marginW / 2;

      // Beside its part, then down if that room has gone, then kept on the
      // board.
      const wanted = box ? box.y + box.h / 2 - height / 2 : MAIN.y;
      const top =
        Math.min(Math.max(wanted, lowest[side]), MAIN.y + MAIN.h - height) + size;
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
          ...(n > 0 ? { after: n * 520 } : {}),
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
          from: { x: onLeft ? cx + marginW / 2 - 6 : cx - marginW / 2 + 6, y: midY },
          to: { x: onLeft ? box.x : box.x + box.w, y: box.y + box.h / 2 },
          ...(pending.step.tone ? { tone: pending.step.tone } : {}),
        });
        // The line and the name it leaves are meant to touch.
        for (const n of lines.keys()) {
          bonds.push({ a: lineId, b: n === 0 ? pending.id : `${pending.id}_l${n}` });
        }
      }
    }

    // Anything else the beat wanted still stacks, under the picture.
    blocks.length = 0;
    for (const block of writes) blocks.push(block);
  }

  if (figures.length === 1 && writes.length > 0 && blocks.length === 1 + writes.length) {
    const GAP = 26;
    const figureW = Math.round((WIDTH - GAP) * 0.6);
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
    for (const block of writes) {
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

  // --- stack the blocks down MAIN ---
  const fixed = blocks.reduce((sum, b) => sum + (b.height ?? 0), 0);
  const flexible = blocks.filter((b) => b.height === null).length;
  const gutters = Math.max(0, blocks.length - 1) * GUTTER;
  const spare = Math.max(0, MAIN.h - fixed - gutters);
  const flexH = flexible > 0 ? spare / flexible : 0;

  // With no flexible block the stack is shorter than MAIN, so centre it rather
  // than leaving all the empty space at the bottom.
  const stackH = fixed + gutters + flexible * flexH;
  let y = MAIN.y + (flexible === 0 ? Math.max(0, (MAIN.h - stackH) / 2) : 0);

  for (const block of blocks) {
    const h = block.height ?? flexH;
    // Back to the word that asked for this block, so what emit records is
    // where the tutor actually was when she drew it.
    current = block.at ?? -1;
    for (const el of block.place({ x: SIDE, y, w: WIDTH, h })) emit(el);
    y += h + GUTTER;
  }

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
  const settled = resolveOverlaps(elements, bonds, [
    // A label's first room is MAIN, where its scene lives. The whole canvas
    // was once its playground, and a stuck label got parked above the lesson
    // title — clear space, wrong room.
    { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: MAIN.h + 20 },
    // When MAIN is genuinely full, everything below the title is fair — a
    // label near the caption reads as a footnote; one over the heading reads
    // as a mistake.
    { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: CANVAS_H - MAIN.y },
  ], leashes);

  // A part can only be pointed at if its picture is on the board this beat.
  const shown = new Set(show);
  const keptFocus = focus.filter((f) => shown.has(f.split('#')[0]));

  return {
    elements: settled,
    laid: { show, focus: keptFocus },
    steps: revealSteps(beat, byInstruction, keptFocus),
    bonds,
    leashes,
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
 */
function revealSteps(
  beat: ScriptBeat,
  byInstruction: ReadonlyMap<number, string[]>,
  focus: readonly string[],
): RevealStep[] {
  const says = beat.board.filter((it) => it.do === 'say');
  if (says.length === 0) {
    return [
      {
        narration: beat.narration,
        show: [...new Set([...byInstruction.values()].flat())],
        focus: [...focus],
      },
    ];
  }

  const steps: RevealStep[] = [];
  const cumulative: string[] = [];
  let narration: string | null = null;

  const flush = (): void => {
    if (narration === null) return;
    steps.push({ narration, show: [...cumulative], focus: [] });
  };

  beat.board.forEach((item, n) => {
    if (item.do === 'say') {
      flush();
      narration = item.text;
      return;
    }
    for (const id of byInstruction.get(n) ?? []) {
      if (!cumulative.includes(id)) cumulative.push(id);
    }
  });
  flush();

  // Anything drawn before the first word still belongs on the board from the
  // start — a title written above the scene should not wait for a sentence.
  if (steps.length > 0) {
    const early = beat.board
      .slice(0, beat.board.findIndex((it) => it.do === 'say'))
      .flatMap((_, n) => byInstruction.get(n) ?? []);
    for (const step of steps) {
      for (const id of early) if (!step.show.includes(id)) step.show.unshift(id);
    }
    // The beat's emphasis belongs to its last moment, where the point is made.
    steps[steps.length - 1].focus = [...focus];
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
